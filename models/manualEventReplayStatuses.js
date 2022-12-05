var mongoose = require("mongoose");
var Schema = mongoose.Schema;

const manualEventReplayStatusesSchema = new Schema({
	
    replayEventsManually: {
		type: Boolean,
	},
	lastBlockForEventsReplay:{
		type:Number,
	},
	lastestBlock: {
		type: Number,
	},
    status : {
        type : String
    }

});

var manualEventReplayStatuses = mongoose.model("manualEventReplayStatuses", manualEventReplayStatusesSchema);
module.exports = manualEventReplayStatuses;