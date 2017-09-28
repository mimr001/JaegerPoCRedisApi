'use strict'

////////////////////// START Jaeger Stuff /////////////////////////
// Auto instrumentation MUST BE ON FIRST LINE TO KICK IN!!!
const Instrument = require('@risingstack/opentracing-auto')

// Jaeger tracer (standard distributed tracing)
const jaeger = require('jaeger-client')
const UDPSender = require('jaeger-client/dist/src/reporters/udp_sender').default
const sampler = new jaeger.RateLimitingSampler(10)
// Need this since the Jaeger server parts (reporter, collector, storage etc) are running outside the scope of our
// Docker stack in this PoC. Real case scenario, the Jaeger server parts will either run in the same
// Docker stack or in a separate Docker stack but on the same host to avoid network latency to the reporter
const reporter = new jaeger.RemoteReporter(new UDPSender({
  // host: 'ec2-54-93-196-139.eu-central-1.compute.amazonaws.com', // Directly on EC2 Node for now...
  // host: 'docker.for.mac.localhost',
  // host: 'localhost',
  // port: 6832
  host: process.env.JAEGER_AGENT_UDP_HOST,
  port: process.env.JAEGER_AGENT_UDP_PORT

}))
const jaegerTracer = new jaeger.Tracer('jaeger-poc-redisapi-jaeger-tracer', reporter, sampler)

// Metrics tracer ("free" metrics data through the use of a second tracer)
const {Tags, FORMAT_HTTP_HEADERS} = require('opentracing')
const MetricsTracer = require('@risingstack/opentracing-metrics-tracer')
const prometheusReporter = new MetricsTracer.PrometheusReporter()
const metricsTracer = new MetricsTracer('jaeger-poc-redisapi-metrics-tracer', [prometheusReporter])

const tracers = [metricsTracer, jaegerTracer]
const instrument = new Instrument({
  tracers: tracers
})
////////////////////// END Jaeger Stuff /////////////////////////

// THESE GET AUTO INSTRUMENTED THANKS TO THE FIRST LINE
const express = require('express')
const http = require('http')
const redis = require('redis')

console.log("Jaeger UDP host:" + process.env.JAEGER_AGENT_UDP_HOST)
console.log("Jaeger UDP port:" + process.env.JAEGER_AGENT_UDP_PORT)

var app = express()
var redisClient = redis.createClient(6379, 'redis')
// var redisClient = redis.createClient(6379, 'localhost')

app.get('/counter', function(req, res, next) {
  redisClient.incr('counter', function(err, counter) {
    if(err) {
      return next(err)
    }

    res.end('Redis counter is: ' + counter)
  })
})

// Metrics endpoint, typically for scraping with Prometheus or equivalent
app.get('/metrics', (req, res) => {
  res.set('Content-Type', MetricsTracer.PrometheusReporter.Prometheus.register.contentType)
  res.end(prometheusReporter.metrics())
})

http.createServer(app).listen(8081, function() {
  console.log('Listening on port 8081')
})