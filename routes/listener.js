var express = require('express');
var router = express.Router();
const CasperSDK = require("casper-js-sdk");
const { EventStream, EventName, CLValueBuilder, CLValueParsers, CLMap, CasperServiceByJsonRPC, } = CasperSDK;

//for all env variables imports
require("dotenv").config();

// importing models
var listener_event_Id_Data = require("../models/listener_eventsIdData");
var packageHashesData = require("../models/packageHashes");

//importing kafka producer
var producer = require("./producer"); 

// authoriztion libraries and imports
const auth = require("../middlewares/auth");
const passport = require("passport");
const verifyAdmin = passport.authenticate("jwt", {
  session: false,
});

//Connect to Redis
var redis = require('../connectRedis');

//for global use
var contractsPackageHashes=[];
var PackageHashes=[];

// creating a connection to a node for RPC API endpoints
const casperService = new CasperServiceByJsonRPC(
  process.env.JSON_RPC_API_NODE_URL
);

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
                  timestamp : event.body.DeployProcessed.timestamp,
                  block_hash : event.body.DeployProcessed.block_hash,
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
              redis.client.RPUSH(acc[0]);
              
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

// to get the latest block height of a node
async function getLatestBlockHeight() {
  const latestBlockInfoResult = await casperService.getLatestBlockInfo();
  console.log(
    "latestBlockInfoResult: ",
    latestBlockInfoResult.block.header.height
  );
  return latestBlockInfoResult.block.header.height;
}

// to get block data of a node against block height
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

// to get the deploy Data of a node against deployHash
async function getdeployData(deployHash) {
  const deployInfoResult = await casperService.getDeployInfo(deployHash);
  console.log("deployInfoResult: ", deployInfoResult);
  return deployInfoResult;
}

//This function replay Events (which being missed when listener backend goes down) upon restart the listener server
async function traverseAllBlocksAndDeploys() {
  
  await addPackageHashes();
  console.log("packagesHashes :", PackageHashes);

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
                  
                    // converting events information into JSON form
                    acc = [{
                      deployHash : deployHashesResult.deploy.hash,
                      timestamp : deployHashesResult.deploy.header.timestamp,
                      block_hash : deployHashesResult.execution_results[0].block_hash,
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
                    redis.client.RPUSH(acc[0]);

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

// This endpoint is just for testing the replayEventsFeature
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
