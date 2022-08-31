var mongoose = require("mongoose");
var Schema = mongoose.Schema;

const eventReplayStatusCheckSchema = new Schema({
	id: {
		type: String
	},
	eventsReplayStatus: {
		type: String
	}
});

var eventReplayStatusCheck = mongoose.model("eventReplayStatusCheck", eventReplayStatusCheckSchema);
module.exports = eventReplayStatusCheck;