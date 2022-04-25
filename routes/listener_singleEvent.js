var express = require('express');
var router = express.Router();
var Hook = require("./hook");
var event_Id = require("../models/eventId");
// var graphqlevent = require("../models/events");
var listener_event_data = require("../models/listener_eventsIdData");
const CasperSDK = require("casper-js-sdk");
const { EventStream, EventName, CLValueBuilder, CLValueParsers, CLMap } = CasperSDK;




router.route("/getMissingEvent").post(async function (req, res, next) {
  try {
    if(!req.body.eventId){
        return res.status(400).json({
          success: false,
          message: "No Event Id specified",
        });
    }
    let event =  await listener_event_data.findOne({eventId: req.body.eventId});
    if(!event){
       return res.status(400).json({
          success: false,
          message: "No Event Found Against given event ID",
        });
    }
    await triggerwebhook(event.eventId, event.deployHash, event.timestamp, event.block_hash, event.eventName, event.eventsdata);
    return res.status(200).json({
        success: true,
        message: "Missing Event Sent.",
        status: "Completed",
      });
  }
  catch{
    console.log("error (try-catch) : " + error);
    return res.status(500).json({
      success: false,
      err: error,
      });}
})

async function triggerwebhook(eventId,deployHash,timestamp,blockHash,eventname,eventdata)
{
  Hook.webHooks.trigger('hook', { eventId: eventId.toString(), deployHash: deployHash, timestamp: timestamp, block_hash: blockHash, eventname: eventname, eventdata: eventdata });
}


module.exports = router;
