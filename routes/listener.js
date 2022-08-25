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

//import library to create pool to limit no of connections to RPC
const genericPool = require("generic-pool");

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
  try {
    let Hashes = await packageHashesData.findOne({ id: "0" });
    if (Hashes == null) {
      console.log("There is no PackageHash stored in database");
    } else {
      PackageHashes = Hashes.packageHashes;
    }
  } catch (error) {
    throw error;
  }
}

//listener main function
//This function looks for every Processed deploy comes to subscriped node
//then filter those deploys for events if there packageHash matches to our
//contract's packageHases

async function listener()
{
  try {
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
              console.log("Last block saved, When last block is null.");
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
  } catch (error) {
    throw error;
  }
}

async function startEventListener(){
  await sleep(15000);
  listener();
}
startEventListener();

async function saveEventInDataBase(deployHash,eventName,timestamp,blockHash,eventsdata)
{
  try {
    let eventResult= new eventsDataModel ({
      deployHash:deployHash,
      eventName:eventName,
      timestamp:timestamp,
      block_hash: blockHash,
      status:"pending",
      eventType:"NotSame",
      eventsdata:eventsdata
    });
    await eventsDataModel.create(eventResult);
    return eventResult;
  } catch (error) {
    throw error;
  }
}

async function produceInKafka(data,eventResult,queue)
{
  try {
    await producer.produceEvents(data);
    eventResult.status="produced";
    await eventResult.save();
  } catch (error) {
    throw error;
  }
}

async function pushEventsToKafka(queue)
{
  try {
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

            if(eventResult!=null && JSON.stringify(eventResult.eventsdata) == JSON.stringify(deserializedHeadValue.eventsdata) && eventResult.status == "produced"){
              console.log("Event is repeated, skipping kafka production...");
            }  
            else{

              if(eventResult==null)
              {
                  console.log("Event is New, producing in kafka...");
                  //store new event Data
                  let result =await saveEventInDataBase(deserializedHeadValue.deployHash,deserializedHeadValue.eventName,deserializedHeadValue.timestamp,deserializedHeadValue.block_hash,deserializedHeadValue.eventsdata);
                  //produce read Event to kafka
                  await produceInKafka(deserializedHeadValue,result);
              }
              else{
                if(JSON.stringify(eventResult.eventsdata) != JSON.stringify(deserializedHeadValue.eventsdata)){
                  if(eventResult.eventType == "NotSame")
                  {
                    console.log("Event has same EventName, producing in kafka...");
                    //store new event Data
                    let result =await saveEventInDataBase(deserializedHeadValue.deployHash,deserializedHeadValue.eventName,deserializedHeadValue.timestamp,deserializedHeadValue.block_hash,deserializedHeadValue.eventsdata);
                    result.eventType="same";
                    eventResult.eventType="same";
                    await result.save();
                    await eventResult.save();
                    //produce read Event to kafka
                    await produceInKafka(deserializedHeadValue,result);
                  } else{
                    console.log("Event is repeated, skipping producing in kafka...");
                  }
                }
                else if(eventResult.status == "pending"){
                    console.log("Event is in pending status in database, produce in kafka...");
                    //produce read Event to kafka
                    await produceInKafka(deserializedHeadValue);
                }
              }
            }
            await redis.client.LPOP(queue);
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
  } catch (error) {
    throw error;
  }
  
}

//this code is for replay Events if server goes down, (under testing) 
// to get the latest block height of a node
async function getLatestBlockHeight(retries =  process.env.RETRIES) {
  try {
    const latestBlockInfoResult = await casperService.getLatestBlockInfo();
    return latestBlockInfoResult.block.header.height;

  } catch (error) {
    console.log("RPC failed: in fecthing latest blockData");
    console.log("error is : ",error);
    if (retries > 0) {
      console.log("Retrying the RPC Call for latest blockData");
      const turnsLeft = retries - 1;
      console.log("Remaining retries: ",turnsLeft);
      return await getLatestBlockHeight(turnsLeft);
    }
    else{
      console.log("Retry calls got greater than 10 ... throwing error ");
      throw error;
    }
  }
}

// to get the last block height when the server shut down
async function getLastBlockHeight(retries = process.env.RETRIES) {
  try {
    let lastBlock= await redis.client.GET(process.env.LASTBLOCK);
    if(lastBlock==null)
    {
      return null;
    }
    else{
      const lastBlockInfoResult = await casperService.getBlockInfo(lastBlock);
      return lastBlockInfoResult.block.header.height;
    }
  } catch (error) {
    console.log("RPC failed: in fecthing last blockData");
    console.log("error is : ",error);
    if (retries > 0) {
      console.log("Retrying the RPC Call for last blockData");
      const turnsLeft = retries - 1;
      console.log("Remaining retries: ",turnsLeft);
      return await getLastBlockHeight(turnsLeft);
    }
    else{
      console.log("Retry calls got greater than 10 ... throwing error ");
      throw error;
    }
  }
}

// to get block data of a node against block height
async function getblockData(height,retries = process.env.RETRIES) {
  try {

    let data= await eventsReplayDataModel.find({blockHeight:height});
    if(data.length == 0 || data[0].blockData.block.body.deploy_hashes.length != data.length)
    {
      console.log("Fetching block : \n",height);
      let blocksResponse=await casperService.getBlockInfoByHeight(height);
      console.log("Block Fetched : \n",blocksResponse.block.header.height);
      return blocksResponse;
    }
    else
    {
      return false;
    }
  } catch (error) {
    console.log("RPC failed: in fecthing blockData "+height);
    console.log("error is : ",error);
    if (retries > 0) {
      console.log("Retrying the RPC Call for block: ",height);
      const turnsLeft = retries - 1;
      console.log("Remaining retries: ",turnsLeft);
      return await getblockData(height,turnsLeft);
    }
    else{
      console.log("Retry calls got greater than 10 ... throwing error ");
      throw error;
    }
  } 
}

// to get the deploy Data of a node against deployHash and insert to Database
async function getdeployDataAndInsertInDatabase(deployHash,height,blocksResponse,retries = process.env.RETRIES) {
 try {
    console.log("Fetching deploy : \n",deployHash);
    let deploysResponse=await casperService.getDeployInfo(deployHash);
    console.log("Deploy fetched: \n",deployHash);
    var newData= new eventsReplayDataModel({
      blockHeight:height,
      blockData:blocksResponse,
      deployData:deploysResponse,
      status:"Added"
    });
    await eventsReplayDataModel.create(newData);
 } catch (error) {
    console.log("RPC failed: in fecthing latest deployHash: ",deployHash);
    console.log("error is : ",error);
    if (retries > 0) {
      console.log("Retrying the RPC Call for deployHash: ",deployHash);
      const turnsLeft = retries - 1;
      console.log("Remaining retries: ",turnsLeft);
      await getdeployDataAndInsertInDatabase(deployHash,height,blocksResponse,turnsLeft);
    }
    else{
      console.log("Retry calls got greater than 10 ... throwing error ");
      throw error;
    }
 }   
}

//factory object to create the pool
const factory = {
  create: function () {
    console.log("factory create");
    return {};
  },
  destroy: function () {
    console.log("factory destroy");
    return true;
  }
};

const opts = {
  max: process.env.POOLSIZE, // maximum size of the pool
};

//This function fetch required blocks and deploys data and insert in Redis HashMap
async function fetchBlocksAndDeploysData(lastBlock,latestBlock) {
  try {
      console.log("In fetch function...");
      console.log("Start Block: ",lastBlock);
      console.log("End Block: ",latestBlock);
      let myPool = genericPool.createPool(factory, opts);
      for (var i = lastBlock; i < latestBlock; i++) {
        let blockResource=await myPool.acquire();
          getblockData(i)
          .then(async function(blocksResponse) {
            if(blocksResponse != false){
                let height,deployHashes;
                height=blocksResponse.block.header.height;
                deployHashes = blocksResponse.block.body.deploy_hashes;
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
                        let deployResource= await myPool.acquire();
                         getdeployDataAndInsertInDatabase(deployHashes[j],height,blocksResponse)
                         .then(async function(result) {
                            // return resource back to pool      
                              await myPool.release(deployResource)
                              .catch(function (err) {
                                  console.log("err=>", err);
                              });
                         });
                      }
                      else{
                          console.log("Deploy's Data already fetched from RPC server...");
                      }
                      let resourcesAvailable=myPool.available;
                      let poolSize=myPool.size;
                      console.log("resourcesAvailable: ",resourcesAvailable);
                      console.log("poolSize: ",poolSize);
                      if(poolSize==process.env.POOLSIZE && resourcesAvailable == 0)
                      {
                        while(resourcesAvailable == 0)
                        {
                          console.log("waiting for resources availability...");
                          await sleep(2000);
                          resourcesAvailable=myPool.available;
                        }
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
            // return resource back to pool 
            await myPool.release(blockResource)
            .catch(function (err) {
              console.log("err=>", err);
            });

          });
          let resourcesAvailable=myPool.available;
          let poolSize=myPool.size;
          console.log("resourcesAvailable: ",resourcesAvailable);
          console.log("poolSize: ",poolSize);
          if(poolSize==process.env.POOLSIZE && resourcesAvailable ==0)
          {
            while(resourcesAvailable == 0)
            {
              console.log("waiting for resources availability...");
              await sleep(2000);
              resourcesAvailable=myPool.available;
            }
          }
      }
  }
  catch (error) {
    throw error;
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
        data= await eventsReplayDataModel.find({blockHeight:height});
        await sleep(2000);
      }
      console.log("Found All DeploysData "+ height);
      return data;
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
                                timestamp : (new Date(deploysResponse.deploy.header.timestamp)).getTime(),
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
                              //redis.client.RPUSH(process.env.LISTENERREDISEVENTSREPLAYQUEUE,serialize({obj: acc[0]}));
          
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

// This function will update time after every 5 seconds,
// because we want to check time interval for server shutdown
// and take required steps
async function updateTime()
{
  try {
    let currentDate = new Date().getTime();
    await redis.client.SET(process.env.TIMEATSHUTDOWN,currentDate);
  } catch (error) {
    throw error;
  }
}
setInterval(() => {
  updateTime();
},5000);

async function timeDiff()
{
  try {
    let timeAtShutDown=await redis.client.GET(process.env.TIMEATSHUTDOWN);
    console.log("timeAtShutDown: ",timeAtShutDown);
    let currentDate = new Date().getTime();
    console.log("LatestTime: ",currentDate);
    let diff=currentDate-timeAtShutDown;
    diff=16000000;
    if(diff > process.env.TTL && timeAtShutDown!= null){
      console.log("Time Difference is greater than 25 minutes..");
      return true;
    }
    else{
      console.log("Time Difference is not greater than 25 minutes..");
      return false;
    }
  } catch (error) {
    throw error;
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
        if(lastBlock==null)
        {
          await redis.client.SET(process.env.LASTBLOCKFOREVENTSREPLAY,"null");
        }
        else{
          await redis.client.SET(process.env.LASTBLOCKFOREVENTSREPLAY,lastBlock.toString());
        }
        
        latestBlock= await getLatestBlockHeight();
        console.log("Latest Block height is : ",latestBlock);
        await redis.client.SET(process.env.LASTESTBLOCK,latestBlock.toString());
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
      await redis.client.SET(process.env.LASTESTBLOCK,latestBlock.toString());
    }
    console.log("iseventsReplay: ",iseventsReplay);
    console.log("lastBlock: ",lastBlock);

    if(iseventsReplay == "true" || (lastBlock != null || lastBlock != "null") )
    {
      console.log("Starting Events Reply...");

      var interval = setInterval(() => {
      pushEventsToKafka(process.env.LISTENERREDISEVENTSREPLAYQUEUE);
      }, 2000);
      lastBlock="692104";
      latestBlock="692204";
      fetchBlocksAndDeploysData(parseInt(lastBlock),parseInt(latestBlock));
      await addPackageHashes();
      console.log("packagesHashes :", PackageHashes);
      contractsPackageHashes =PackageHashes.map((h) => h.toLowerCase());
      filterEventsReplayModel(parseInt(lastBlock),parseInt(latestBlock))
      .then(async function (response) {
        console.log("FilterEventsReplayModel Response: ",response);
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
    throw error;
  }
}
checkIfEventsMissed();

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