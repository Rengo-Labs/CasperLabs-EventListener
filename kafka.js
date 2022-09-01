//for all env variables imports
require("dotenv").config();

//imports
const { Kafka } = require('kafkajs');

//configuration
const kafka = new Kafka({
  clientId: process.env.CLIENTID,
  brokers: [process.env.SERVER],
  ssl: {
    rejectUnauthorized: true
  },
  sasl: {
    mechanism: process.env.MECHANISM,
    username: process.env.SASL_USERNAME,
    password: process.env.SASL_PASSWORD,
  },
  connectionTimeout: 5000,
  requestTimeout: 30000,
  retry: {
    initialRetryTime: 300,
    retries: Number.MAX_VALUE 
  }
});


module.exports = kafka;

