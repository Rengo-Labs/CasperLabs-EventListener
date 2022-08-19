var express = require('express');
var router = express.Router();
const CasperSDK = require("casper-js-sdk");
const { EventStream, EventName, CLValueBuilder, CLValueParsers, CLMap, CasperServiceByJsonRPC, } = CasperSDK;

//for all env variables imports
require("dotenv").config();

// importing models
var packageHashesData = require("../models/packageHashes");
var eventsDataModel = require("../models/eventsData");
var eventsReplayDataModel = require("../models/eventsReplayData");

//seting up kafka
//setting up a producer
const producer = require('../producer');

// authoriztion libraries and imports
const auth = require("../middlewares/auth");
const passport = require("passport");
const verifyAdmin = passport.authenticate("jwt", {
  session: false,
});

//Connect to Redis
var redis = require('../connectRedis');

//import library to serilize EventData
var serialize = require('serialize-javascript');

//for global use
var contractsPackageHashes=[];
var PackageHashes=[];
var queuePopFlag=0;

// // creating a connection to a node for RPC API endpoints
const casperService = new CasperServiceByJsonRPC(
  process.env.JSON_RPC_API_NODE_URL
);

//function to deserialize Event Data
function deserialize(serializedJavascript){
  return eval('(' + serializedJavascript + ')');
}

const sleep = (num) => {
  return new Promise((resolve) => setTimeout(resolve, num));
};

//to retrieve packageHashes from database and add them to the listener
async function addPackageHashes() {
  let Hashes = await packageHashesData.findOne({ id: "0" });
  if (Hashes == null) {
    console.log("There is no PackageHash stored in database");
  } else {
    PackageHashes = Hashes.packageHashes;
  }
}

//listener main function
//This function looks for every Processed deploy comes to subscriped node
//then filter those deploys for events if there packageHash matches to our
//contract's packageHases

async function listener()
{
  
  await addPackageHashes();
  console.log("packagesHashes :", PackageHashes);

  const es = new EventStream(process.env.EVENTSTREAM_URL);
  
  contractsPackageHashes =PackageHashes.map((h) => h.toLowerCase());

  es.subscribe(EventName.DeployProcessed,async(event)=> {
    if (event.body.DeployProcessed.execution_result.Success) {
      
      const { transforms } = event.body.DeployProcessed.execution_result.Success.effect;

        redis.client.GET(process.env.LASTBLOCK)
        .then(async function (lastBlock) {
          if(lastBlock==null)
          {
            redis.client.SET(process.env.LASTBLOCK,event.body.DeployProcessed.block_hash);
            console.log("Last block saved.");
          }
        });
        
        const events = transforms.reduce (async(acc, val) => {
        if (val.transform.hasOwnProperty("WriteCLValue") && typeof val.transform.WriteCLValue.parsed === "object" && val.transform.WriteCLValue.parsed !== null) 
        {
          const maybeCLValue = CLValueParsers.fromJSON(val.transform.WriteCLValue);
          const clValue = maybeCLValue.unwrap();
          if (clValue && clValue instanceof CLMap) {
            const hash = clValue.get(
              CLValueBuilder.string("contract_package_hash")
            );
            const eventname = clValue.get(CLValueBuilder.string("event_type"));
            console.log("contractsPackageHashes array = ",contractsPackageHashes);
            if (hash && contractsPackageHashes.includes(hash.value())) {
              
              // converting events information into JSON form
              acc = [{ 
                  deployHash : event.body.DeployProcessed.deploy_hash,
                  timestamp : (new Date(event.body.DeployProcessed.timestamp)).getTime(),
                  block_hash : event.body.DeployProcessed.block_hash,
                  eventName: eventname.value(),
                  eventsdata: JSON.parse(JSON.stringify(clValue.data)),
              }];

              //displaying event all data
              console.log("Event Received: ",eventname.value());
              console.log("DeployHash: ",acc[0].deployHash);
              console.log("Timestamp: ",acc[0].timestamp);
              console.log("Block Hash: ",acc[0].block_hash);
              console.log("Data: ",acc[0].eventsdata);

              //push event to redis queue
              redis.client.RPUSH(process.env.LISTENERREDISQUEUE,serialize({obj: acc[0]}));
              console.log("Event pushed to queue.");
              redis.client.SET(process.env.LASTBLOCK,event.body.DeployProcessed.block_hash);
              console.log("Last block saved.");
            }
          }
        }
        return acc;
      },[]);
    }
  });
  
  es.start();
  console.log("Listener initiated...");
}

async function startEventListener(){
  await sleep(30000);
  listener();
}
startEventListener();

async function pushEventsToKafka(queue)
{
  if(queuePopFlag==0)
  {
    
    let redisLength=await redis.client.LLEN(queue);
    
    //check redis queue length
    if(redisLength>0)
    {
        queuePopFlag=1;
        let headValue=await redis.client.LRANGE(queue,0,0);
        let deserializedHeadValue=(deserialize(headValue)).obj;
        console.log("Event Read from queue's head: ", deserializedHeadValue);

        //check if event is in the database
        let eventResult= await eventsDataModel.findOne({
          deployHash:deserializedHeadValue.deployHash,
          eventName:deserializedHeadValue.eventName,
          timestamp:deserializedHeadValue.timestamp,
          block_hash: deserializedHeadValue.block_hash
        });

        if (eventResult==null || JSON.stringify(eventResult.eventsdata) != JSON.stringify(deserializedHeadValue.eventsdata) || eventResult.status == "pending")
        {
          if(eventResult==null || JSON.stringify(eventResult.eventsdata) != JSON.stringify(deserializedHeadValue.eventsdata))
          {
            //store new event Data
            eventResult= new eventsDataModel ({
              deployHash:deserializedHeadValue.deployHash,
              eventName:deserializedHeadValue.eventName,
              timestamp:deserializedHeadValue.timestamp,
              block_hash: deserializedHeadValue.block_hash,
              status:"pending",
              eventsdata: deserializedHeadValue.eventsdata
            });
            await eventsDataModel.create(eventResult);
          }
          
          if(eventResult==null)
          {
            console.log("Event is New, producing in kafka...");
          }
          else if(JSON.stringify(eventResult.eventsdata) != JSON.stringify(deserializedHeadValue.eventsdata)){
            console.log("Event has same EventName, producing in kafka...");
          }
          else if(eventResult.status == "pending"){
            console.log("Event is in pending status in database, produce in kafka...");
          }

          //produce read Event to kafka
          await producer.produceEvents(deserializedHeadValue);
          eventResult.status="produced";
          await eventResult.save();
          await redis.client.LPOP(queue);
          
        }
        else{
          console.log("Event is repeated, skipping kafka production...");
          await redis.client.LPOP(queue);
        }  
        queuePopFlag=0;
    }
    else{
      console.log("There are currently no Events in the Redis queue name = " + queue);
      return;
    }
  }
  else{
    console.log("Already, one Event is producing in kafka...");
    return;
  }
}

//this code is for replay Events if server goes down, (under testing) 
// to get the latest block height of a node
async function getLatestBlockHeight() {
  try {
    const latestBlockInfoResult = await casperService.getLatestBlockInfo();
    if(latestBlockInfoResult.error)
    {
      while(latestBlockInfoResult.error)
      {
        latestBlockInfoResult = await casperService.getLatestBlockInfo();
      }
    }
    return latestBlockInfoResult.block.header.height;
  } catch (error) {
    throw error;
  }
}

// to get the last block height when the server shut down
async function getLastBlockHeight() {
  try {
    let lastBlock= await redis.client.GET(process.env.LASTBLOCK);
    if(lastBlock==null)
    {
      return false;
    }
    else{
      const lastBlockInfoResult = await casperService.getBlockInfo(lastBlock);
      if(lastBlockInfoResult.error)
      {
        while(lastBlockInfoResult.error)
        {
          lastBlockInfoResult = await casperService.getBlockInfo(lastBlock);
        }
      }
      return lastBlockInfoResult.block.header.height;
    }
  } catch (error) {
    throw error;
  }
}

// to get block data of a node against block height
async function getblockData(height) {
  try {
    let data= await eventsReplayDataModel.find({blockHeight:height});

    if(data.length == 0 || data[0].blockData.block.body.deploy_hashes.length != data.length)
    {
      console.log("Fetching block : \n",height);
      const blockInfoByHeightResult = casperService.getBlockInfoByHeight(height)
      return blockInfoByHeightResult;
      // .then(async function (blocksResponse) {
      //   if(blocksResponse.error)
      //   {
      //     getblockData(height);
      //   }
      //   else{
      //     return blocksResponse;
      //   }
      // });
    }
    else
    {
      return false;
    }
  } catch (error) {
    throw error;
  }
  
}

// to get the deploy Data of a node against deployHash and insert to redis HashMap
async function getdeployDataAndInsertInRedisHashMap(deployHash,height,blocksResponse) {
  
  try {
    console.log("Fetching deploy : \n",deployHash);
    casperService.getDeployInfo(deployHash)
    .then(async function (deploysResponse) {
      if(deploysResponse.error)
      {
        getdeployDataAndInsertInRedisHashMap(deployHash,height,blocksResponse);
      }
      else{
          console.log("Deploy fetched: \n",deployHash);
          var newData= new eventsReplayDataModel({
                blockHeight:height,
                blockData:blocksResponse,
                deployData:deploysResponse,
                status:"Added"
          });
          await eventsReplayDataModel.create(newData);
      } 
    });
  } catch (error) {
    throw error;
  }
}

//This function fetch required blocks and deploys data and insert in Redis HashMap
async function fetchBlocksAndDeploysData(lastBlock,latestBlock) {
  try {

      console.log("In fetch function...");
      let start=lastBlock;
      let end=lastBlock;
      let noOfBlocksToQuery=1;
      if(latestBlock-lastBlock>=5)
      {
        noOfBlocksToQuery=5;
      }
      while(lastBlock<=latestBlock)
      {   
          if(end+noOfBlocksToQuery>latestBlock)
          {
              if(((end+noOfBlocksToQuery)-latestBlock)<=5)
              {
                noOfBlocksToQuery=1;
              }
              else{
                break;
              }
          }
          start=end;
          end=end+noOfBlocksToQuery;
          console.log("start: ",start);
          console.log("end: ",end);
          console.log("lastBlock: ",lastBlock);
          
          for (var i = start; i < end; i++) {
            getblockData(i)
            .then(async function (blocksResponse) {
              console.log("blocksResponse: ",blocksResponse);
              let height,deployHashes;
              if(blocksResponse != false){
                height=blocksResponse.block.header.height;
                deployHashes = blocksResponse.block.body.deploy_hashes;
                console.log("Block fetched: \n",height);
                if (deployHashes.length != 0) {
                  let data= await eventsReplayDataModel.find({blockHeight:height});
                  for (var j = 0; j < deployHashes.length; j++) {
                    let flag=0;
                    if(data.length!=0)
                    {
                      for (var k=0;k<data.length;k++)
                      {
                        if (data[k].deployData.deploy.hash === deployHashes[j]) {
                          flag=1;
                        }
                      }
                    }
                    if(flag==0)
                    {
                      getdeployDataAndInsertInRedisHashMap(deployHashes[j],height,blocksResponse);
                    }
                    else{
                      console.log("Deploy's Data already fetched from RPC server...");
                    }
                  }
                }
                else{
                  let blockData={
                    block:{
                      body:{
                        deploy_hashes:["0"]
                      }
                    }
                  };
                  var newData= new eventsReplayDataModel({
                    blockHeight:height,
                    blockData:blockData,
                  });
                  await eventsReplayDataModel.create(newData);
                }
              }
              else{
                console.log("Block Data already fetched from RPC server and filtered.");
              }
            });
            console.log("i: ",i);
          }
          let flag=0;
          while(flag==0)
          {
            if(noOfBlocksToQuery==1)
            {
              await sleep(2000);
            }
            else{
              await sleep(5000);
            }
            flag=1;
          }
          lastBlock=lastBlock+noOfBlocksToQuery;
      }
  }
  catch (error) {
    console.log("error comes: ",error);
  }
}

async function checkingEventsReplayModelLength(){
  try {
    let eventsReplayData= await eventsReplayDataModel.find({});
    console.log("eventsReplayData Length: ",eventsReplayData);
    if(eventsReplayData.length == 0)
    {
      while(eventsReplayData.length == 0)
      {
        console.log("Fetching eventsReplayData length...");
        eventsReplayData= await eventsReplayDataModel.find({});
        await sleep(2000);
      }
      console.log("EventsReplayData length is greater than zero... ");
      return eventsReplayData.length;
    }
    else
    {
      console.log("EventsReplayData length is greater than zero... ");
      return eventsReplayData.length;
    }
  } catch (error) {
    throw error;
  }
}

async function checkingSpecificBlockData(height){
  try {
    let eventsReplayData= await eventsReplayDataModel.find({blockHeight:height});
    console.log("eventsReplayData at height : "+ height + " = "+eventsReplayData);
    if(eventsReplayData.length == 0)
    {
      while(eventsReplayData.length == 0)
      {
        console.log("Block-"+height+" waiting for its data");
        eventsReplayData= await eventsReplayDataModel.find({blockHeight:height});
        await sleep(2000);
      }
      
      console.log("Found BlockData "+ height);
      return eventsReplayData;
    }
    else{
      console.log("Found BlockData "+ height);
      return eventsReplayData;
    }
  } catch (error) {
    throw error;
  }
}

async function checkingDeployDatawithDeployHashes(height,data){
  try {

    if(data[0].blockData.block.body.deploy_hashes.length != data.length)
    {
      while(data[0].blockData.block.body.deploy_hashes.length != data.length)
      {
        console.log("Block-"+height+" waiting for deployHashes length gets equal "+data[0].blockData.block.body.deploy_hashes.length +"-"+ data.length);
        eventsReplayData= await eventsReplayDataModel.find({blockHeight:height});
        await sleep(2000);
      }
      console.log("Found All DeploysData "+ height);
      return eventsReplayData;
    }
    else{
      console.log("Found All DeploysData "+ height);
      return data;
    }
  } catch (error) {
    throw error;
  }
}

//This function filters events from EventsReplayModel and push events to Redis eventReplay queue
async function filterEventsReplayModel(lastBlock,latestBlock) {
  try {
      console.log("In filter function...");
      await checkingEventsReplayModelLength();

      for(var i=lastBlock;i<=latestBlock;i++)
      {
            console.log("In the first loop");
            let data=await checkingSpecificBlockData(i); 
            console.log("outside while 1");
            if(data[0].blockData.block.body.deploy_hashes[0]!="0")
            {
              data=await checkingDeployDatawithDeployHashes(i,data);
              console.log("outside while 2");
              for(var j=0;j<data[0].blockData.block.body.deploy_hashes.length;j++)
              {
                  console.log("In the second loop");
                  let blockAndDeployData,deploysResponse;
                  for(var k=0;k<data.length;k++)
                  {
                    console.log("In the third loop");
                    if(data[0].blockData.block.body.deploy_hashes[j]== data[k].deployData.deploy.hash)
                    {
                      blockAndDeployData=data[k];
                      break;
                    }
                  }
                  if(blockAndDeployData.status=="Added")
                  {
                    deploysResponse=blockAndDeployData.deployData;
                    console.log("deploysResponse: ", deploysResponse);
                    if (deploysResponse.execution_results[0].result.Success) {
                      let transforms =
                      deploysResponse.execution_results[0].result.Success.effect
                          .transforms;
                      console.log("transforms: ",transforms);
                      for (var x=0;x<transforms.length;x++)
                      {
                        console.log("In the 4th loop");
                        if (transforms[x].transform.hasOwnProperty("WriteCLValue") && typeof transforms[x].transform.WriteCLValue.parsed === "object" && transforms[x].transform.WriteCLValue.parsed !== null) 
                        {
                          const maybeCLValue = CLValueParsers.fromJSON(transforms[x].transform.WriteCLValue);
                          const clValue = maybeCLValue.unwrap();
                          if (clValue && clValue instanceof CLMap) {
                            const hash = clValue.get(
                              CLValueBuilder.string("contract_package_hash")
                            );
                            const eventname = clValue.get(CLValueBuilder.string("event_type"));
                            if (hash && contractsPackageHashes.includes(hash.value())) {
                    
                              // converting events information into JSON form
                              acc = [{
                                deployHash : deploysResponse.deploy.hash,
                                timestamp : deploysResponse.deploy.header.timestamp,
                                block_hash : deploysResponse.execution_results[0].block_hash,
                                eventName: eventname.value(),
                                status: "Pending",
                                eventsdata: JSON.parse(JSON.stringify(clValue.data)),
                              }];
          
                              //displaying event all data
                              console.log("Event Received: ",eventname.value());
                              console.log("DeployHash: ",acc[0].deployHash);
                              console.log("Timestamp: ",acc[0].timestamp);
                              console.log("Block Hash: ",acc[0].block_hash);
                              console.log("Status: ",acc[0].status);
                              console.log("Data: ",acc[0].eventsdata);
          
                              //push event to redis queue
                              redis.client.RPUSH(process.env.LISTENERREDISEVENTSREPLAYQUEUE,acc[0]);
          
                            }
                            else{
                              console.log("This is not our contract's event.");
                            }
                          }
                        }
                      }
                      blockAndDeployData.status="Filtered";
                      await blockAndDeployData.save();
                  }
                }
                else{
                  console.log("Deploy already filtered...");
                }
              }
            }
            
      }
      return "eventsReplayCompleted";
      
  }
  catch (error) {
    throw error; 
  }
}

async function timeDiff()
{
  let timeAtShutDown=await redis.client.GET(process.env.TIMEATSHUTDOWN);
  console.log("timeAtShutDown: ",timeAtShutDown);
  let currentDate = new Date().getTime();
  console.log("LatestTime: ",currentDate);
  let diff=currentDate-timeAtShutDown;
  diff=1600000;
  if(diff > process.env.TTL && timeAtShutDown!= null){
    return true;
  }
  else{
    return false;
  }
}
//This function is to syncUp both EventStream and EventsReplay Features
async function checkIfEventsMissed()
{
  try {

    let eventsReplayStatus = await redis.client.GET(process.env.EVENTSREPLAYSTATUS);
    let iseventsReplay,lastBlock,latestBlock; 
    if(eventsReplayStatus == null || eventsReplayStatus == "DONE")
    {
      iseventsReplay=await timeDiff();
      await redis.client.SET(process.env.TIMEFOREVENTSREPLAY,iseventsReplay.toString());
      if(iseventsReplay)
      {
        await redis.client.SET(process.env.EVENTSREPLAYSTATUS,"PROGRESS");

        lastBlock= await getLastBlockHeight();
        console.log("lastBlock height is : ",lastBlock);
        await redis.client.SET(process.env.LASTBLOCKFOREVENTSREPLAY,lastBlock);
  
        latestBlock= await getLatestBlockHeight();
        console.log("Latest Block height is : ",latestBlock);
        await redis.client.SET(process.env.LASTESTBLOCK,latestBlock);
      }
    }
    iseventsReplay=await redis.client.GET(process.env.TIMEFOREVENTSREPLAY);
    lastBlock = await redis.client.GET(process.env.LASTBLOCKFOREVENTSREPLAY);
    latestBlock = await redis.client.GET(process.env.LASTESTBLOCK);

    let latestTimeCheck=await timeDiff();
    if (latestTimeCheck)
    {
      latestBlock= await getLatestBlockHeight();
      console.log("Latest Block height is : ",latestBlock);
      await redis.client.SET(process.env.LASTESTBLOCK,latestBlock);
    }

    if(iseventsReplay || lastBlock != false )
    {
      console.log("Starting Events Reply...");

      let DummyLastBlock = 692104;
      let DummyLatestBlock = 692110;
      
      var interval = setInterval(() => {
      pushEventsToKafka(process.env.LISTENERREDISEVENTSREPLAYQUEUE);
      }, 2000);

      fetchBlocksAndDeploysData(DummyLastBlock,DummyLatestBlock);
      filterEventsReplayModel(DummyLastBlock,DummyLatestBlock)
      .then(async function (response) {
        console.log("FilterRedisHashMap Response: ",response);
        let eventsReplayresult=response;
        if(eventsReplayresult=="eventsReplayCompleted"){
          console.log("EventsReplay Completed... ");
          let redisLength=await redis.client.LLEN(process.env.LISTENERREDISEVENTSREPLAYQUEUE);
          while(redisLength!= 0)
          {
            redisLength=await redis.client.LLEN(process.env.LISTENERREDISEVENTSREPLAYQUEUE);
            await sleep(2000);
          }
          clearInterval(interval);
          await redis.client.SET(process.env.EVENTSREPLAYSTATUS,"DONE");
          console.log("Popping and Producing EventStream Events... ");
          setInterval(() => {
            pushEventsToKafka(process.env.LISTENERREDISQUEUE);
          }, 2000);
          }
      });
    }
    else{
      setInterval(() => {
        pushEventsToKafka(process.env.LISTENERREDISQUEUE);
      }, 2000);
    }
  } catch (error) {
    console.log("error comes: ",error);
  }
  
}
checkIfEventsMissed();

// This function will update time after every 5 seconds,
// because we want to check time interval for server shutdown
// and take required steps
async function updateTime()
{
  let currentDate = new Date().getTime();
  await redis.client.SET(process.env.TIMEATSHUTDOWN,currentDate);
}
setInterval(() => {
  updateTime();
},5000);

/**
 * @swagger
 * components:
 *   schemas:
 *     PackageHashes:
 *       type: object
 *       required:
 *         - id
 *         - packageHashes
 *       properties:
 *         id:
 *           type: string
 *           description: The id for the PackageHashes document
 *         packageHashes:
 *           type: string
 *           description: The packageHashes for listener to listen      
 */

/**
 * @swagger
 * /listener/addPackageHashToListener:
 *   post:
 *     description: This endpoint is used to add packageHash to the listener. 
 *     tags: [PackageHashes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               packageHashes:
 *                 type: string 
 *           examples:
 *             '1':
 *               value: "{\r\n   \"packageHash\":\"c956ddec09b725a217ac5480fc9cef2411c73b6aaac2e6215ca7255d20f77485\"\r\n}"
 *             '2':
 *               value: "{\r\n \r\n}"
 *             '3':
 *               value: "{\r\n  \"packageHash\":\"c956ddec09b725a217ac5480fc9cef2411c73b6aaac2e6215ca7255d20f77485\"\r\n}" 
 * 
 *     responses:
 *       200:
 *         description: PackageHash added to the listener.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                         "responseStatus": {
 *                             "success": true,
 *                             "errorCode": 0,
 *                             "errorMessage": "",
 *                             "error": null
 *                         },
 *                         "body": {
 *                             "message": "PackageHash c956ddec09b725a217ac5480fc9cef2411c73b6aaac2e6215ca7255d20f77485 added to the listener."
 *                         }
 *                     }
 *
 *       400:
 *         description: if any parameter not found in the body
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                           "responseStatus": {
 *                             "success": false,
 *                             "errorCode": 400,
 *                             "errorMessage": "There was no packageHash specified in the req body.",
 *                             "error": {}
 *                           },
 *                           "body": null
 *                         }
 *       406:
 *         description: if packageHash already added to the listener
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                           "responseStatus": {
 *                             "success": false,
 *                             "errorCode": 406,
 *                             "errorMessage": "This packageHash c956ddec09b725a217ac5480fc9cef2411c73b6aaac2e6215ca7255d20f77485 already added to the listener.",
 *                             "error": {}
 *                           },
 *                           "body": null
 *                         } 
 * 
 */

// This endpoint is to add a new packageHash to the listener
router
  .route("/addPackageHashToListener")
  .post(auth.verifyToken, verifyAdmin, async function (req, res, next) {
    try {
      if (!req.body.packageHash) {
        return res.status(400).json({
          success: false,
          message: "There was no packageHash specified in the req body.",
        });
      }
      if (PackageHashes.includes(req.body.packageHash)) {
        return res.status(406).json({
          success: false,
          message:
            "This packageHash " +
            req.body.packageHash +
            " already added to the listener.",
        });
      } else {
        PackageHashes.push(req.body.packageHash);
        contractsPackageHashes = PackageHashes.map((h) => h.toLowerCase());
        console.log("contractsPackageHashes: ", contractsPackageHashes);
        return res.status(200).json({
          success: true,
          message:
            "PackageHash " + req.body.packageHash + " added to the listener.",
        });
      }
    } catch (error) {
      console.log("error (try-catch) : " + error);
      return res.status(500).json({
        success: false,
        err: error,
      });
    }
});

/**
 * @swagger
 * /listener/addPackageHashesInDatabase:
 *   post:
 *     description: This endpoint is used to add packageHashes to the database. 
 *     tags: [PackageHashes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               packageHashes:
 *                   type: array
 *                   items:
 *                     type: string 
 *           examples:
 *             '1':
 *               value: "{\r\n   \"packageHashes\":[\"5956ddec09b725a217ac5480fc9cef2411c73b6aaac2e6215ca7255d20f77485\",
 *                   \"a956ddec09b725a217ac5480fc9cef2411c73b6aaac2e6215ca7255d20f77485\"]\r\n}"
 *             '2':
 *               value: "{\r\n \r\n}"
 *             '3':
 *               value: "{\r\n   \"packageHashes\":[\"6956ddec09b725a217ac5480fc9cef2411c73b6aaac2e6215ca7255d20f77485\",
 *                   \"9956ddec09b725a217ac5480fc9cef2411c73b6aaac2e6215ca7255d20f77485\"]\r\n}"
 * 
 *     responses:
 *       200:
 *         description: PackageHashes added Successfully in the database.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                         "responseStatus": {
 *                             "success": true,
 *                             "errorCode": 0,
 *                             "errorMessage": "",
 *                             "error": null
 *                         },
 *                         "body": {
 *                             "message": "PackageHashes added Successfully in the database."
 *                         }
 *                     }
 *
 *       400:
 *         description: if any parameter not found in the body
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                           "responseStatus": {
 *                             "success": false,
 *                             "errorCode": 400,
 *                             "errorMessage": "There was no packageHashes specified in the req body",
 *                             "error": {}
 *                           },
 *                           "body": null
 *                         }
 *       406:
 *         description: if PackageHashes already added in the database. 
 *         content:
 *           application/json:
 *            schema:
 *               type: string
 *               example: {
 *                          "responseStatus": {
 *                             "success": false,
 *                             "errorCode": 406,
 *                             "errorMessage": "PackageHashes already added in the database.",
 *                             "error": {}
 *                           },
 *                           "body": null
 *                         }
 */

//This endpoint is to add all the packageHashes in the database
router
  .route("/addPackageHashesInDatabase")
  .post(auth.verifyToken, verifyAdmin, async function (req, res, next) {
    try {
      if (!req.body.packageHashes) {
        return res.status(400).json({
          success: false,
          message: "There was no packageHashes specified in the req body.",
        });
      }
      let packageHashesResult = await packageHashesData.findOne({ id: "0" });
      if (packageHashesResult == null) {
        let newInstance = new packageHashesData({
          id: "0",
          packageHashes: req.body.packageHashes,
        });
        await packageHashesData.create(newInstance);
        return res.status(200).json({
          success: true,
          message: "PackageHashes added Successfully in the database. ",
        });
      } else {
        return res.status(406).json({
          success: false,
          message: "PackageHashes already added in the database. ",
        });
      }
    } catch (error) {
      console.log("error (try-catch) : " + error);
      return res.status(500).json({
        success: false,
        err: error,
      });
    }
});

/**
 * @swagger
 * /listener/updatePackageHashesInDatabase:
 *   post:
 *     description: This endpoint is used to update packageHashes to the database.
 *     tags: [PackageHashes]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               packageHashes:
 *                   type: array
 *                   items:
 *                     type: string 
 *           examples:
 *             '1':
 *               value: "{\r\n   \"packageHashes\":[\"5956ddec09b725a217ac5480fc9cef2411c73b6aaac2e6215ca7255d20f77485\",
 *                   \"a956ddec09b725a217ac5480fc9cef2411c73b6aaac2e6215ca7255d20f77485\"]\r\n}"
 *             '2':
 *               value: "{\r\n \r\n}"
 *             '3':
 *               value: "{\r\n   \"packageHashes\":[\"6956ddec09b725a217ac5480fc9cef2411c73b6aaac2e6215ca7255d20f77485\",
 *                   \"9956ddec09b725a217ac5480fc9cef2411c73b6aaac2e6215ca7255d20f77485\"]\r\n}" 
 * 
 *     responses:
 *       200:
 *         description: PackageHashes updated Successfully in the database.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                         "responseStatus": {
 *                             "success": true,
 *                             "errorCode": 0,
 *                             "errorMessage": "",
 *                             "error": null
 *                         },
 *                         "body": {
 *                             "message": "PackageHashes updated Successfully in the database."
 *                         }
 *                     }
 *
 *       400:
 *         description: if any parameter not found in the body
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                           "responseStatus": {
 *                             "success": false,
 *                             "errorCode": 400,
 *                             "errorMessage": "There was no packageHashes specified in the req body",
 *                             "error": {}
 *                           },
 *                           "body": null
 *                         }
 *       404:
 *         description: if PackageHashes not added in the database. 
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: {
 *                           "responseStatus": {
 *                             "success": false,
 *                             "errorCode": 404,
 *                             "errorMessage": "PackageHashes not added in the database.",
 *                             "error": {}
 *                           },
 *                           "body": null
 *                         } 
 */ 

//This endpoint is to update the packageHashes in the database
router
  .route("/updatePackageHashesInDatabase")
  .post(auth.verifyToken, verifyAdmin, async function (req, res, next) {
    try {
      if (!req.body.packageHashes) {
        return res.status(400).json({
          success: false,
          message: "There was no packageHashes specified in the req body.",
        });
      }
      let packageHashesResult = await packageHashesData.findOne({ id: "0" });
      if (packageHashesResult == null) {
        return res.status(404).json({
          success: false,
          message: "PackageHashes not added in the database.",
        });
      } else {
        const filter = { id: "0" };
        const update = { packageHashes: req.body.packageHashes };
        let updatedData = await packageHashesData.findOneAndUpdate(
          filter,
          update
        );
        console.log("updated packageHashes : ", updatedData);
        return res.status(200).json({
          success: true,
          message: "PackageHashes updated Successfully in the database. ",
        });
      }
    } catch (error) {
      console.log("error (try-catch) : " + error);
      return res.status(500).json({
        success: false,
        err: error,
      });
    }
});
module.exports = router;
