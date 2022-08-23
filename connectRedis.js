//for all env variables imports
require("dotenv").config();

const redis =require('redis');

// const client = redis.createClient({
//     host: process.env.REDIS_HOSTNAME,
//     port: process.env.REDIS_PORT,
//     password: process.env.REDIS_PASSWORD
// });
const client = redis.createClient({});

client.on('connect', function(){
    console.log('Connected to Redis...');
}); 

client.on('error', (err) => console.log('Redis Client Error', err));

async function connectDatabase()
{
    await client.connect();
}

connectDatabase();

module.exports = {client};