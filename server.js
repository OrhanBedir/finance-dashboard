// Render entry point — delegates to backend/server.js
process.chdir(__dirname + '/backend');
require('./backend/server.js');
