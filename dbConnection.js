//for all env variables imports
require("dotenv").config();

var mongoose = require('mongoose');

var connect = function() {
    console.log("DB_URL : " + process.env.DATABASE_URL_ONLINE);
    mongoose.connect(process.env.DATABASE_URL_ONLINE);
};
connect();

mongoose.connection.on('error', function() {
    console.log('Could not connect to MongoDB');
});

mongoose.connection.on('disconnected', function(){
    console.log('Lost MongoDB connection...');
});

mongoose.connection.on('connected', function() {
    console.log('Connection established to MongoDB');
});

mongoose.connection.on('reconnected', function() {
    console.log('Reconnected to MongoDB');
});

// Close the Mongoose connection, when receiving SIGINT
process.on('SIGINT', function() {
    mongoose.connection.close(function () {
        console.log('Force to close the MongoDB conection');
        process.exit(0);
    });
});