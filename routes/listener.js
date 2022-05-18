var express = require('express');
var router = express.Router();
var Hook = require("./hook");
require("dotenv").config();
const CasperSDK = require("casper-js-sdk");
const { EventStream, EventName, CLValueBuilder, CLValueParsers, CLMap } = CasperSDK;
var listenerEventsData = require("../models/listenerEventsData");
var packageHashesData = require("../models/packageHashes");
var contractsPackageHashes=[];
var PackageHashes=[];

async function addPackageHashes()
{
  let Hashes=await packageHashesData.findOne({id:"0"});
  if(Hashes==null)
  {
    console.log("There is no PackageHash stored in database")
  }
  else{
    PackageHashes=Hashes.packageHashes;
  }
}

async function listener()
{
  await addPackageHashes();
  console.log("packagesHashes :",PackageHashes);

  const es = new EventStream("http://159.65.118.250:9999/events/main");
  
  contractsPackageHashes =PackageHashes.map((h) => h.toLowerCase());

  es.subscribe(EventName.DeployProcessed,async(event)=> {
    if (event.body.DeployProcessed.execution_result.Success) {
      const { transforms } = event.body.DeployProcessed.execution_result.Success.effect;
        //console.log("transforms: ",transforms);
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
              acc = [{ name: eventname.value(), deployHash : event.body.DeployProcessed.deploy_hash, timestamp : event.body.DeployProcessed.timestamp, block_hash : event.body.DeployProcessed.block_hash, clValue }];
              console.log("event emmited : ",eventname.value());
              console.log("deployHash: ",acc[0].deployHash);
              console.log("timestamp: ",acc[0].timestamp);
              var date = new Date(acc[0].timestamp);
              var miliseconds = date.getTime();
              console.log("timestamp in miliseconds: ",miliseconds);
              console.log("block_hash: ",acc[0].block_hash);

              let newData = JSON.parse(JSON.stringify(acc[0].clValue.data));
              console.log("newData: ",newData);

              let listenerEventsDataResult=await listenerEventsData.findOne({eventName:acc[0].name,deployHash:acc[0].deployHash});
              if(listenerEventsDataResult!=null)
              {
                console.log(acc[0].name+ " Event exists already, deployHash = " + acc[0].deployHash);
              }
              else{
                let newInstance = new listenerEventsData({
                  deployHash: acc[0].deployHash,
                  eventName: acc[0].name,
                  timestamp: miliseconds,
                  block_hash: acc[0].block_hash,
                  eventsdata: newData
                });
                await listenerEventsData.create(newInstance);
  
                await triggerwebhook(acc[0].deployHash,miliseconds,acc[0].block_hash,acc[0].name,newData);
              }
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
listener();

async function triggerwebhook(deployHash,timestamp,blockHash,eventname,eventdata)
{
  Hook.webHooks.trigger('hook', { deployHash: deployHash, timestamp: timestamp, block_hash: blockHash, eventname: eventname, eventdata: eventdata });

  // Hook.emitter.on('*.success', function (shortname, statusCode, body) {
  //     //console.log('Success on trigger webHook ' + shortname + 'with status code', statusCode, 'and body', body)
  // })

  // Hook.emitter.on('*.failure', function (shortname, statusCode, body) {
  //     //console.error('Error on trigger webHook ' + shortname + 'with status code', statusCode, 'and body', body)
  // })

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

router.route("/addcontractPackageHashesInDatabase").post(async function (req, res, next) {
  try {

    if(!req.body.packageHashes)
    {
      return res.status(400).json({
        success: false,
        message: "There was no contractPackageHash specified in the req body.",
      });
    }
    let newInstance = new packageHashesData({
     id: "0",
     packageHashes:req.body.packageHashes
    });
    await packageHashesData.create(newInstance);
    return res.status(200).json({
      success: true,
      message: "contractPackageHashes added Successfully in the database. ",
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
