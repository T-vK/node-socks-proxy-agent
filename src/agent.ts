import dns from 'dns';
import net from 'net';
import tls from 'tls';
import url from 'url';
import createDebug from 'debug';
import { Agent, ClientRequest, RequestOptions } from 'agent-base';
import { SocksClient, SocksProxy, SocksClientOptions, SocksClientChainOptions } from 'socks';
import { SocksProxyAgentOptions } from '.';

const debug = createDebug('socks-proxy-agent');

function dnsLookup(host: string): Promise<string> {
	return new Promise((resolve, reject) => {
		dns.lookup(host, (err, res) => {
			if (err) {
				reject(err);
			} else {
				resolve(res);
			}
		});
	});
}

function parseSocksProxy(
	opts: SocksProxyAgentOptions
): { lookup: boolean; proxy: SocksProxy } {
	let port = 0;
	let lookup = false;
	let type: SocksProxy['type'] = 5;

	// Prefer `hostname` over `host`, because of `url.parse()`
	const host = opts.hostname || opts.host;
	if (!host) {
		throw new TypeError('No "host"');
	}

	if (typeof opts.port === 'number') {
		port = opts.port;
	} else if (typeof opts.port === 'string') {
		port = parseInt(opts.port, 10);
	}

	// From RFC 1928, Section 3: https://tools.ietf.org/html/rfc1928#section-3
	// "The SOCKS service is conventionally located on TCP port 1080"
	if (!port) {
		port = 1080;
	}

	// figure out if we want socks v4 or v5, based on the "protocol" used.
	// Defaults to 5.
	if (opts.protocol) {
		switch (opts.protocol) {
			case 'socks4:':
				lookup = true;
			// pass through
			case 'socks4a:':
				type = 4;
				break;
			case 'socks5:':
				lookup = true;
			// pass through
			case 'socks:': // no version specified, default to 5h
			case 'socks5h:':
				type = 5;
				break;
			default:
				throw new TypeError(
					`A "socks" protocol must be specified! Got: ${opts.protocol}`
				);
		}
	}

	if (typeof opts.type !== 'undefined') {
		if (opts.type === 4 || opts.type === 5) {
			type = opts.type;
		} else {
			throw new TypeError(`"type" must be 4 or 5, got: ${opts.type}`);
		}
	}

	const proxy: SocksProxy = {
		host,
		port,
		type
	};

	let userId = opts.userId || opts.username;
	let password = opts.password;
	if (opts.auth) {
		const auth = opts.auth.split(':');
		userId = auth[0];
		password = auth[1];
	}
	if (userId) {
		Object.defineProperty(proxy, 'userId', {
			value: userId,
			enumerable: false
		});
	}
	if (password) {
		Object.defineProperty(proxy, 'password', {
			value: password,
			enumerable: false
		});
	}

	return { lookup, proxy };
}

/**
 * The `SocksProxyAgent`.
 *
 * @api public
 */
export default class SocksProxyAgent extends Agent {
	private lookups: boolean[];
	private proxies: SocksProxy[];

	constructor(rawOpts: string | SocksProxyAgentOptions | (string|SocksProxyAgentOptions)[]) {
		// Turn rawOpts into an array if it isn't already:
		let rawOptsArray: (string|SocksProxyAgentOptions)[];
		if(!Array.isArray(rawOpts)) {
            rawOptsArray = [rawOpts];
		} else {
			rawOptsArray = rawOpts;
		}

		// If rawOptsArray contains strings, convert it into a pure array of SocksProxyAgentOptions:
		let opts: SocksProxyAgentOptions[] = [];
		for (const rawOpt of rawOptsArray) {
			if (typeof rawOpt === 'string') {
				debug(url.parse(rawOpt))
				opts.push(url.parse(rawOpt)); // Convert from string to SocksProxyAgentOptions
			} else {
				opts.push(rawOpt);
			}
			if (!rawOpt) {
				throw new TypeError(
					'a SOCKS proxy server `host` and `port` must be specified!'
				);
			}
		}
		super(opts);

		const parsedProxies = opts.map(o=>parseSocksProxy(o));
		this.lookups = parsedProxies.map(p => p.lookup);
		this.proxies = parsedProxies.map(p => p.proxy);
	}

	/**
	 * Initiates a SOCKS connection to the specified SOCKS proxy server,
	 * which in turn connects to the specified remote host and port.
	 *
	 * @api protected
	 */
	async callback(
		req: ClientRequest,
		opts: RequestOptions
	): Promise<net.Socket> {
		const { lookups, proxies } = this;

		let { host, port } = opts;

		if (!host) {
			throw new Error('No `host` defined!');
		}

		if (lookups.length>0 && lookups) {
			// Client-side DNS resolution for "4" and "5" socks proxy versions.
			host = await dnsLookup(host); // This would leak your IP address. Not ideal.
		}

		let socket
		if (proxies.length === 1) {
			const socksOpts: SocksClientOptions = {
				proxy: proxies[0],
				destination: { host, port },
				command: 'connect'
			};
			debug('Creating socks proxy connection: %o', socksOpts);
			({ socket } = await SocksClient.createConnection(socksOpts));
			debug('Successfully created socks proxy connection');
		} else {
			const socksOpts: SocksClientChainOptions = {
				proxies,
				destination: { host, port },
				command: 'connect'
			};
			debug('Creating chained socks proxy connection: %o', socksOpts);
			({ socket } = await SocksClient.createConnectionChain(socksOpts));
			debug('Successfully created chained socks proxy connection');
		}

		if (opts.secureEndpoint) {
			// The proxy is connecting to a TLS server, so upgrade
			// this socket connection to a TLS connection.
			debug('Upgrading socket connection to TLS');
			const servername = opts.servername || host;
			return tls.connect({
				...omit(opts, 'host', 'hostname', 'path', 'port'),
				socket,
				servername
			});
		}

		return socket;
	}
}

function omit<T extends object, K extends [...(keyof T)[]]>(
	obj: T,
	...keys: K
): {
	[K2 in Exclude<keyof T, K[number]>]: T[K2];
} {
	const ret = {} as {
		[K in keyof typeof obj]: (typeof obj)[K];
	};
	let key: keyof typeof obj;
	for (key in obj) {
		if (!keys.includes(key)) {
			ret[key] = obj[key];
		}
	}
	return ret;
}
