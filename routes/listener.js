var express = require('express');
var router = express.Router();
const CasperSDK = require("casper-js-sdk");
const { EventStream, EventName, CLValueBuilder, CLValueParsers, CLMap, CasperServiceByJsonRPC, } = CasperSDK;
var contractsPackageHashes=[];
var PackageHashes=[];

var event_Id = require("../models/eventId");
var listener_event_Id_Data = require("../models/listener_eventsIdData");
var producer = require("./producer"); 

const casperService = new CasperServiceByJsonRPC(
  "http://159.65.118.250:7777/rpc"
);


async function listener()
{
  let _id = await event_Id.findOne({id: '0'});
  console.log('ID : ', _id);
  console.log('Event Id  : ', _id.eventId); 
  console.log('Integer Event Id : ', BigInt(_id.eventId));
  let count = BigInt(_id.eventId);
  const es = new EventStream("http://159.65.118.250:9999/events/main");
  
  contractsPackageHashes =PackageHashes.map((h) => h.toLowerCase());

  es.subscribe(EventName.DeployProcessed,async(event)=> {
    if (event.body.DeployProcessed.execution_result.Success) {
      const { transforms } = event.body.DeployProcessed.execution_result.Success.effect;
        
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
              
              console.log("Original deploy hash : ", event.body.DeployProcessed.deploy_hash);
              console.log('Count : ',count);

              acc = [{ eventId : ++count,name: eventname.value(), deployHash : event.body.DeployProcessed.deploy_hash, timestamp : event.body.DeployProcessed.timestamp, block_hash : event.body.DeployProcessed.block_hash, clValue }];
              console.log("Updated count : ",acc[0].eventId);
              console.log("event emmited : ",eventname.value());
              console.log("deployHash: ",acc[0].deployHash);
              console.log("timestamp: ",acc[0].timestamp);
              var date = new Date(acc[0].timestamp);
              var miliseconds = date.getTime();
              console.log("timestamp in miliseconds: ",miliseconds);
              console.log("block_hash: ",acc[0].block_hash);

              let newData = JSON.parse(JSON.stringify(acc[0].clValue.data));
              console.log("newData: ",newData);
             
              await _id.updateOne({"eventId":acc[0].eventId.toString()});
              const newInstance = new listener_event_Id_Data({
                			eventId: acc[0].eventId,
                      deployHash: acc[0].deployHash,
                      eventName: acc[0].name,
                      timestamp: miliseconds,
                      block_hash: acc[0].block_hash,
                      eventsdata: newData,
                      status: "Pending"
              });
		          await listener_event_Id_Data.create(newInstance);
              producer.produce(newInstance.eventId, newInstance);
              
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

async function getLatestBlockHeight() {
  const latestBlockInfoResult = await casperService.getLatestBlockInfo();
  console.log(
    "latestBlockInfoResult: ",
    latestBlockInfoResult.block.header.height
  );
  return latestBlockInfoResult.block.header.height;
}
//getLatestBlockHeight();

async function getblockData(height) {
  const blockInfoByHeightResult = await casperService.getBlockInfoByHeight(
    height
  );
  console.log("blockInfoByHeightResult: ", blockInfoByHeightResult);
  console.log(
    "blockInfoByHeightResultDeployHashes: ",
    blockInfoByHeightResult.block.body.deploy_hashes
  );
  return blockInfoByHeightResult;
}

async function getdeployData(deployHash) {
  const deployInfoResult = await casperService.getDeployInfo(deployHash);
  console.log("deployInfoResult: ", deployInfoResult);
  return deployInfoResult;
}

async function traverseAllBlocksAndDeploys() {
  
  let _id = await event_Id.findOne({id: '0'});
  console.log('ID : ', _id);
  console.log('Event Id  : ', _id.eventId); 
  console.log('Integer Event Id : ', BigInt(_id.eventId));
  let count = BigInt(_id.eventId);
  
  contractsPackageHashes =PackageHashes.map((h) => h.toLowerCase());

  let currentBlockHeight = 692110;
  let latestBlockHeight = await getLatestBlockHeight();

  for (var i = currentBlockHeight; i < latestBlockHeight; i++) {
    let chainGetBlockResult = await getblockData(i);
    let deployHashes = chainGetBlockResult.block.body.deploy_hashes;
    if (deployHashes.length != 0) {
      for (var j = 0; j < deployHashes.length; j++) {
        let deployHashesResult = await getdeployData(deployHashes[j]);
        //console.log(" deployHashesResult.execution_results[0].result.Success.effect.transforms: ", deployHashesResult.execution_results[0].result.Success.effect.transforms);
        if (deployHashesResult.execution_results[0].result.Success) {
          let transforms =
            deployHashesResult.execution_results[0].result.Success.effect
              .transforms;
          console.log("transforms: ", transforms);
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
                  
                  console.log("Original deploy hash : ", deployHashes[j]);
                  console.log('Count : ',count);
    
                  acc = [{ eventId : ++count,name: eventname.value(), deployHash : deployHashesResult.deploy.hash, timestamp : deployHashesResult.deploy.header.timestamp, block_hash : deployHashesResult.execution_results[0].block_hash, clValue }];
                  console.log("Updated count : ",acc[0].eventId);
                  console.log("event emmited : ",eventname.value());
                  console.log("deployHash: ",acc[0].deployHash);
                  console.log("timestamp: ",acc[0].timestamp);
                  var date = new Date(acc[0].timestamp);
                  var miliseconds = date.getTime();
                  console.log("timestamp in miliseconds: ",miliseconds);
                  console.log("block_hash: ",acc[0].block_hash);
    
                  let newData = JSON.parse(JSON.stringify(acc[0].clValue.data));
                  console.log("newData: ",newData);
                 
                  await _id.updateOne({"eventId":acc[0].eventId.toString()});
                  const newInstance = new listener_event_Id_Data({
                          eventId: acc[0].eventId,
                          deployHash: acc[0].deployHash,
                          eventName: acc[0].name,
                          timestamp: miliseconds,
                          block_hash: acc[0].block_hash,
                          eventsdata: newData,
                          status: "Pending"
                  });
                  await listener_event_Id_Data.create(newInstance);
                  producer.produce(newInstance.eventId, newInstance);
                  
                }
              }
            }
            return acc;
          },[]);
        }
      }
    }
  }
}


router.route("/initiateListener").post(async function (req, res, next) {
    try {

      if(!req.body.contractPackageHashes)
      {
        return res.status(400).json({
          success: false,
          message: "Listener did not initiated, There was no contractPackageHashes specified in the req body.",
        });
      }
      PackageHashes=req.body.contractPackageHashes;
      listener();

      return res.status(200).json({
        success: true,
        message: "Listener Initiated Successfully.",
        status: "Listening...",
      });

    } catch (error) {
      console.log("error (try-catch) : " + error);
      return res.status(500).json({
        success: false,
        err: error,
      });
    }
})

router.route("/replayEvents").post(async function (req, res, next) {
  try {

    if(!req.body.contractPackageHashes)
    {
      return res.status(400).json({
        success: false,
        message: "Listener did not initiated, There was no contractPackageHashes specified in the req body.",
      });
    }
    PackageHashes=req.body.contractPackageHashes;
    traverseAllBlocksAndDeploys();

    return res.status(200).json({
      success: true,
      message: "EventsReplay Started Successfully."
    });

  } catch (error) {
    console.log("error (try-catch) : " + error);
    return res.status(500).json({
      success: false,
      err: error,
    });
  }
})

router.route("/addcontractPackageHash").post(async function (req, res, next) {
    try {

      if(!req.body.contractPackageHash)
      {
        return res.status(400).json({
          success: false,
          message: "There was no contractPackageHash specified in the req body.",
        });
      }
      PackageHashes.push(req.body.contractPackageHash);
      contractsPackageHashes =PackageHashes.map((h) => h.toLowerCase());
      return res.status(200).json({
        success: true,
        message: "contractPackageHash "+ req.body.contractPackageHash +" added to the listener.",
      });

    } catch (error) {
      console.log("error (try-catch) : " + error);
      return res.status(500).json({
        success: false,
        err: error,
      });
    }
});

module.exports = router;
