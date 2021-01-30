/**
 * Module dependencies.
 */

let fs = require('fs');
let url = require('url');
let http = require('http');
let https = require('https');
let assert = require('assert');
let socks = require('socksv5');
let getRawBody = require('raw-body');
let SocksProxyAgent = require('../');

describe('SocksProxyAgent', function() {
	let httpServer;
	let httpPort;
	let httpsServer;
	let httpsPort;
	let socksServer;
	let socksPort;

	before(function(done) {
		// setup SOCKS proxy server
		socksServer = socks.createServer(function(info, accept, deny) {
			accept();
		});
		socksServer.listen(0, '127.0.0.1', function() {
			socksPort = socksServer.address().port;
			done();
		});
		socksServer.useAuth(socks.auth.None());
	});

	before(function(done) {
		// setup target HTTP server
		httpServer = http.createServer();
		httpServer.listen(function() {
			httpPort = httpServer.address().port;
			done();
		});
	});

	before(function(done) {
		// setup target SSL HTTPS server
		let options = {
			key: fs.readFileSync(`${__dirname}/ssl-cert-snakeoil.key`),
			cert: fs.readFileSync(`${__dirname}/ssl-cert-snakeoil.pem`)
		};
		httpsServer = https.createServer(options);
		httpsServer.listen(function() {
			httpsPort = httpsServer.address().port;
			done();
		});
	});

	after(function(done) {
		socksServer.once('close', function() {
			done();
		});
		socksServer.close();
	});

	after(function(done) {
		httpServer.once('close', function() {
			done();
		});
		httpServer.close();
	});

	after(function(done) {
		httpsServer.once('close', function() {
			done();
		});
		httpsServer.close();
	});

	describe('constructor', function() {
		it('should throw an Error if no "proxy" argument is given', function() {
			assert.throws(function() {
				new SocksProxyAgent();
			});
		});
		it('should accept a "string" proxy argument', function() {
			let agent = new SocksProxyAgent(`socks://127.0.0.1:${socksPort}`);
			assert.equal('127.0.0.1', agent.proxies[0].host);
			assert.equal(socksPort, agent.proxies[0].port);
		});
		it('should accept a `url.parse()` result object argument', function() {
			let opts = url.parse(`socks://127.0.0.1:${socksPort}`);
			let agent = new SocksProxyAgent(opts);
			assert.equal('127.0.0.1', agent.proxies[0].host);
			assert.equal(socksPort, agent.proxies[0].port);
		});
	});

	describe('"http" module', function() {
		it('should work against an HTTP endpoint', function(done) {
			httpServer.once('request', function(req, res) {
				assert.equal('/foo', req.url);
				res.statusCode = 404;
				res.end(JSON.stringify(req.headers));
			});

			let agent = new SocksProxyAgent(`socks://127.0.0.1:${socksPort}`);
			let opts = url.parse(`http://127.0.0.1:${httpPort}/foo`);
			opts.agent = agent;
			opts.headers = { foo: 'bar' };
			let req = http.get(opts, function(res) {
				assert.equal(404, res.statusCode);
				getRawBody(res, 'utf8', function(err, buf) {
					if (err) return done(err);
					let data = JSON.parse(buf);
					assert.equal('bar', data.foo);
					done();
				});
			});
			req.once('error', done);
		});
	});

	describe('"https" module', function() {
		it('should work against an HTTPS endpoint', function(done) {
			httpsServer.once('request', function(req, res) {
				assert.equal('/foo', req.url);
				res.statusCode = 404;
				res.end(JSON.stringify(req.headers));
			});

			let agent = new SocksProxyAgent(`socks://127.0.0.1:${socksPort}`);
			let opts = url.parse(`https://127.0.0.1:${httpsPort}/foo`);
			opts.agent = agent;
			opts.rejectUnauthorized = false;

			opts.headers = { foo: 'bar' };
			let req = https.get(opts, function(res) {
				assert.equal(404, res.statusCode);
				getRawBody(res, 'utf8', function(err, buf) {
					if (err) return done(err);
					let data = JSON.parse(buf);
					assert.equal('bar', data.foo);
					done();
				});
			});
			req.once('error', done);
		});
	});
});

describe('SocksProxyAgent with proxy chain', function() {
	let httpServer;
	let httpPort;
	let httpsServer;
	let httpsPort;
	let socksServers = [];
	let socksPorts = [];
	const proxyChainLength = 10;

	before(function(done) {
		// setup SOCKS proxy servers
		let serversReady = 0;
		for (let i=0; i<proxyChainLength; i++) {
			socksServers[i] = socks.createServer(function(info, accept, deny) {
				accept();
			});
			socksServers[i].listen(0, '127.0.0.1', function() {
				socksPorts[i] = socksServers[i].address().port;
				serversReady++;
				if (serversReady === proxyChainLength) {
					done();
				}
			});
			socksServers[i].useAuth(socks.auth.None());
		}
	});

	before(function(done) {
		// setup target HTTP server
		httpServer = http.createServer();
		httpServer.listen(function() {
			httpPort = httpServer.address().port;
			done();
		});
	});

	before(function(done) {
		// setup target SSL HTTPS server
		let options = {
			key: fs.readFileSync(`${__dirname}/ssl-cert-snakeoil.key`),
			cert: fs.readFileSync(`${__dirname}/ssl-cert-snakeoil.pem`)
		};
		httpsServer = https.createServer(options);
		httpsServer.listen(function() {
			httpsPort = httpsServer.address().port;
			done();
		});
	});

	after(function(done) {
	    let serversClosed = 0;
	    for (const socksServer of socksServers) {
			socksServer.once('close', function() {
				serversClosed++;
				if (serversClosed === proxyChainLength) {
					done();
				}
			});
			socksServer.close();
		}
	});

	after(function(done) {
		httpServer.once('close', function() {
			done();
		});
		httpServer.close();
	});

	after(function(done) {
		httpsServer.once('close', function() {
			done();
		});
		httpsServer.close();
	});

	describe('constructor', function() {
		it('should throw an Error if no "proxy" argument is given', function() {
			assert.throws(function() {
				new SocksProxyAgent();
			});
		});
		it('should accept an "array of string proxies" argument', function() {
			const proxies = socksPorts.map(socksPort => `socks://127.0.0.1:${socksPort}`);
			const agent = new SocksProxyAgent(proxies);
			assert(proxyChainLength, agent.proxies.length);
			for (let i=0; i<proxyChainLength; i++) {
				assert.equal('127.0.0.1', agent.proxies[i].host);
				assert.equal(socksPorts[i], agent.proxies[i].port);
			}
		});
		it('should accept an "array of `url.parse()` result objects" argument', function() {
			const proxies = socksPorts.map(socksPort => url.parse(`socks://127.0.0.1:${socksPort}`));
			const agent = new SocksProxyAgent(proxies);
			assert(proxyChainLength, agent.proxies.length);
			for (let i=0; i<proxyChainLength; i++) {
				assert.equal('127.0.0.1', agent.proxies[i].host);
				assert.equal(socksPorts[i], agent.proxies[i].port);
			}
		});
		it('should accept a mixed array of "`url.parse()` result objects" and "string proxies" as an argument', function() {
			const proxies = [
				url.parse(`socks://127.0.0.1:${socksPorts[0]}`),
				`socks://127.0.0.1:${socksPorts[1]}`,
				url.parse(`socks://127.0.0.1:${socksPorts[2]}`),
				`socks://127.0.0.1:${socksPorts[3]}`
			];
			const agent = new SocksProxyAgent(proxies);
			assert(proxies.length, agent.proxies.length);
			for (let i=0; i<proxies.length; i++) {
				assert.equal('127.0.0.1', agent.proxies[i].host);
				assert.equal(socksPorts[i], agent.proxies[i].port);
			}
		});
	});

	describe('"http" module', function() {
		it('should work against an HTTP endpoint', function(done) {
			httpServer.once('request', function(req, res) {
				assert.equal('/foo', req.url);
				res.statusCode = 404;
				res.end(JSON.stringify(req.headers));
			});

			const proxies = socksPorts.map(socksPort => `socks://127.0.0.1:${socksPort}`);
			const agent = new SocksProxyAgent(proxies);

			let opts = url.parse(`http://127.0.0.1:${httpPort}/foo`);
			opts.agent = agent;
			opts.headers = { foo: 'bar' };
			let req = http.get(opts, function(res) {
				assert.equal(404, res.statusCode);
				getRawBody(res, 'utf8', function(err, buf) {
					if (err) return done(err);
					let data = JSON.parse(buf);
					assert.equal('bar', data.foo);
					done();
				});
			});
			req.once('error', done);
		});
	});

	describe('"https" module', function() {
		it('should work against an HTTPS endpoint', function(done) {
			httpsServer.once('request', function(req, res) {
				assert.equal('/foo', req.url);
				res.statusCode = 404;
				res.end(JSON.stringify(req.headers));
			});

			const proxies = socksPorts.map(socksPort => `socks://127.0.0.1:${socksPort}`);
			const agent = new SocksProxyAgent(proxies);
			let opts = url.parse(`https://127.0.0.1:${httpsPort}/foo`);
			opts.agent = agent;
			opts.rejectUnauthorized = false;

			opts.headers = { foo: 'bar' };
			let req = https.get(opts, function(res) {
				assert.equal(404, res.statusCode);
				getRawBody(res, 'utf8', function(err, buf) {
					if (err) return done(err);
					let data = JSON.parse(buf);
					assert.equal('bar', data.foo);
					done();
				});
			});
			req.once('error', done);
		});
	});
});
