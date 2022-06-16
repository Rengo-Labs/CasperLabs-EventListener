var mongoose = require('mongoose');
var Schema = mongoose.Schema;


const eventSchema = new Schema({

    id:{
      type:String,
      default:'0'
    },

    eventId:{
      type : String
    },
    
    completedEventId:{
      type : String
    },
});

var event_Id = mongoose.model("event_Id", eventSchema);
module.exports = event_Id;
