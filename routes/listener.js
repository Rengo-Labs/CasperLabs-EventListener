var express = require('express');
var router = express.Router();
var Hook = require("./hook");
const CasperSDK = require("casper-js-sdk");
const axios = require('axios').default;
const { EventStream, EventName, CLValueBuilder, CLValueParsers, CLMap } = CasperSDK;
var contractsPackageHashes=[];
var PackageHashes=[];

var event_Id = require("../models/eventId");
var listener_event_Id_Data = require("../models/listener_eventsIdData");
var producer = require("./producer"); 

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
              //let graphqlName = await listener_event_Id_Data.findOne({eventName:eventname.value(),deployHash:event.body.DeployProcessed.deploy_hash});
              let graphqlName = null;
              console.log("Graphql Name : ", graphqlName);
              console.log("Original deploy hash : ", event.body.DeployProcessed.deploy_hash);
              if(graphqlName == null){ 
                console.log('Count : ',count);

            
              acc = [{ eventId : ++count,name: eventname.value(), deployHash : event.body.DeployProcessed.deploy_hash, timestamp : event.body.DeployProcessed.timestamp, block_hash : event.body.DeployProcessed.block_hash, clValue }];
              console.log("Updated count : ",acc[0].eventId);
              //console.log("event.body.DeployProcessed.execution_result: ",event.body.DeployProcessed.execution_result);
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

              // await triggerwebhook(acc[0].deployHash,miliseconds,acc[0].block_hash,acc[0].name,newData);
              }
              else{
                console.log("Event already existed : ", graphqlName);
                console.log("Original deploy hash : ", event.body.DeployProcessed.deploy_hash)
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

router.route("/remindListener").get(async function (req, res, next) {
  try {

    return res.status(200).json({
      success: true,
      message: "Listener Reminded Successfully.",
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

module.exports = router;
