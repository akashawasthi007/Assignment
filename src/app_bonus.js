/*
Steps to run teh application.

1. Install below dependencies using npm
    axios
    dotenv
    express
    express-rate-limit
    node-cache
    nodemon
2. Add below part in package.json

 "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1",
    "dev": "fileName.js"
  },

3. Create a file fineName.js in the same directory and paste the below code mention in the file.
3. run using command in terminal - npm run dev    

*/

const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const morgan = require('morgan');
require('dotenv').config();

// Initialize Express application
const app = express();
const port = process.env.PORT || 3000; // Default port is 3000

// Configure rate limit and cache duration via environment variables
const RATE_LIMIT_WINDOW_MS = process.env.RATE_LIMIT_WINDOW_MS || 60 ; // Default: 1 minute
const RATE_LIMIT_MAX_REQUESTS = process.env.RATE_LIMIT_MAX_REQUESTS || 5;   // Default: 5 requests per window
const CACHE_DURATION_SECONDS = process.env.CACHE_DURATION_SECONDS || 300; // Default: 5 minutes

// Set up in-memory cache (cache successful API responses for 5 minutes)
const cache = new NodeCache({ stdTTL: CACHE_DURATION_SECONDS }); // TTL = 5 minutes

// Set up rate limiter (5 requests per minute per IP address)
const limiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS, // Time window
    max: RATE_LIMIT_MAX_REQUESTS,  // Max requests per window
    message: 'Too many requests, please try again later.',
    statusCode: 429,               // Ensure 429 status code is returned
    headers: true,                 // Include rate limit info in the response headers
  });

// Custom middleware to log rate limit status and request details
app.use((req, res, next) => {
  // Log the request details including rate limit status
  res.on('finish', () => {
    const rateLimitLimit = res.getHeader('X-RateLimit-Limit');
    const rateLimitRemaining = res.getHeader('X-RateLimit-Remaining');
    const rateLimitReset = res.getHeader('X-RateLimit-Reset');
    
    // Format reset time (Unix timestamp to human-readable time)
    const resetTime = new Date(Number(rateLimitReset)*1000).toISOString();

    console.log(`[INFO] ${new Date().toISOString()} | IP: ${req.ip} | Method: ${req.method} | URL: ${req.originalUrl} | Status: ${res.statusCode} | RateLimit: ${rateLimitRemaining}/${rateLimitLimit} remaining | Reset: ${resetTime}`);
  });
  
  next();
});

app.use(limiter);

// Define a valid API key for authentication
const VALID_API_KEY = 'hello';

// Authentication mechanism as middleware
const authenticate = (req, res, next) => {
  const apiKey = req.headers['authorization'];

  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'No API key provided. Please include the Authorization header.',
    });
  }

  if (apiKey !== VALID_API_KEY) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid API key.',
    });
  }

  next(); // API key is valid, proceed to the next 
};

// Apply authentication mechanism to the /proxy 
app.use('/proxy', authenticate);

// Define /proxy route
app.get('/proxy', async (req, res) => {
  try {
    // Check if data is in the cache
    const cachedData = cache.get('weatherData');

    if (cachedData) {
      // Serve cached response if available
      console.log('Serving cached data');
      return res.json({
        data: cachedData,
        source: 'cache',
      });
    }

    // If data is not in the cache, make an API call
    const response = await axios.get(
      'http://api.weatherapi.com/v1/current.json?key=0695b7e9012b4c34935163506251301&q=London&aqi=no',
      {
        timeout: 5000, // Set timeout to 5 seconds
      }
    );

    // Check if the response status is OK (200)
    if (response.status === 200) {
      const data = response.data;
      // Cache the response data
      cache.set('weatherData', JSON.stringify(data)); // Store the response in the cache for 5 minutes

      // Return fresh data
      res.json({
        data: JSON.stringify(data),
        source: 'api',
      });
    } else {
      // If the status is not OK, throw an error
      throw new Error(`Unexpected response status: ${response.status}`);
    }
  } catch (err) {
    // Error handling for different types of issues
    if (err.response) {
      // The request was made, but the server responded with an error
      console.error('Error response from API:', err.response.data);
      res.status(err.response.status).json({
        error: 'Error getting data from the external API',
        message: err.response.data,
      });
    } else if (err.request) {
      // The request was made, but no response was received
      console.error('No response received from API:', err.request);
      res.status(503).json({
        error: 'No response from external API',
        message: 'The external API is not responding, please try again later.',
      });
    } else if (err.code === 'ECONNABORTED') {
      // Handle request timeout
      console.error('Request timeout error:', err);
      res.status(504).json({
        error: 'Request timed out',
        message: 'The external API request timed out. Please try again later.',
      });
    } else {
      // For other errors, like invalid URLs or network issues
      console.error('Error occurred:', err);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while fetching data.',
      });
    }
  }
});

// Start server
app.listen(port, () => {
  console.log(`API Proxy server running on http://localhost:${port}`);
});
