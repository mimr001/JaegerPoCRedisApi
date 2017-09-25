const express = require('express')
const http = require('http')
const redis = require('redis');

var app = express()
var redisClient = redis.createClient(6379, 'redis')

app.get('/counter', function(req, res, next) {
  redisClient.incr('counter', function(err, counter) {
    if(err) return next(err)
    res.send('Redis counter is: ' + counter)
  });
});

http.createServer(app).listen(8081, function() {
  console.log('Listening on port 8081')
});