//for all env variables imports
require("dotenv").config();

//imports
const { Partitioners } = require('kafkajs');

//setting up kafka
const kafka=require("./kafka"); 

//creating a producer
const producer= kafka.producer({ 
  createPartitioner: Partitioners.LegacyPartitioner,
  allowAutoTopicCreation: false,
  transactionTimeout: 30000,
  idempotence:true,
  acks:-1
});

async function produceEvents(data)
{
    try {
        //connection a producer
        await producer.connect();
        await producer.send({
          topic: process.env.TOPIC,
          messages: [{
            // The message value is just bytes to Kafka, so we need to serialize our JavaScript
            // object to a JSON string. Other serialization methods like Avro are available.
            value: JSON.stringify(data)
          }]
        })
    
        //console.log('Producer Response', { responses });
        console.log('Published Event', {
            value: data
        })
        //disconnecting producer
        await producer.disconnect();
    } 
    catch (error) {
        console.error('Error publishing message', error)
    }
}

module.exports = {produceEvents};