var mongoose = require("mongoose");
var Schema = mongoose.Schema;

const eventReplayStatusesSchema = new Schema({
	id: {
		type: String
	},
	timeForEventsReplay: {
		type: Boolean,
	},
	lastBlockForEventsReplay:{
		type:Number,
	},
	lastestBlock: {
		type: Number,
	}

});

var eventReplayStatuses = mongoose.model("eventReplayStatuses", eventReplayStatusesSchema);
module.exports = eventReplayStatuses;