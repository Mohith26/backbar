'use strict';
const { report } = require('./helpers');
console.log('backbar test suite');
require('./booking.test')();
require('./waitlist.test')();
require('./storm.test')();
report();

