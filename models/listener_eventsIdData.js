var mongoose = require("mongoose");
var Schema = mongoose.Schema;

const eventIdDataSchema = new Schema({
	deployHash: {
		type: String,
	},
	eventName: {
		type: String,
	},
	eventId: {
		type: String,
	},
	status:{
		type:String,
	},
	timestamp: {
		type: Number,
	},
	block_hash: {
		type: String,
	},
	eventsdata: {
		type: Object,
	},
});

var event_Id_Data = mongoose.model("listener_event_Id_Data", eventIdDataSchema);
module.exports = event_Id_Data;
