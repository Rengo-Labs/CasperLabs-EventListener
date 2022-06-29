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
  connectionTimeout: 3000,
  requestTimeout: 25000,
  retry: {
    initialRetryTime: 100,
    retries: 8
  },
});


module.exports = kafka;

