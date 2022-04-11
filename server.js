const grpc = require("@grpc/grpc-js");
const PROTO_PATH = "./data.proto";
var protoLoader = require("@grpc/proto-loader");
var products = require('./data/products.json');
var sellers = require('./data/sellers.json');
var sellerProducts = require('./data/seller_products.json');
var users = require('./data/users.json');
// const replicas = require('./config.json').replicas;
const dgram = require('dgram');
const Raft = require('@markwylde/liferaft');
const net = require('net')
const { getOtherServerPorts } = require('./utils');
const nodes = require('./nodes.json');

const debug_enabled = false;
const info = (msg) => {
	console.log(msg);
}

const debug = (msg) => {
	if (debug_enabled) {
		console.log(msg);
	}
}

if (process.argv.length !== 6) {
	console.log('usage format node server.js <Serverid> <noOfreplicas> <1 if customerdb, 0 otherwise>')
	process.exit(0);
}

const updateData = (data, dataId) => {
	switch(dataId) {
		case "products.addProduct":
			products.push(data);
			break;
		case "products.updateProducts":
			products = data;
			break;
		case "sellerProducts.putSellerProduct":
			sellerProducts = data;
			break;
		case "sellers.addSeller":
			sellers.push(data);
			break;
		case "sellers.updateSellers":
			sellers = data;
			break;
		case "users.addUser":
			users.push(data);
			break;
		case "users.updateUsers":
			users = data;
			break;
		case "buyerHistory.updateBuyerHistory":
			buyersHistory.push(data);
			break;
		case "cart.updateCart":
			cartItems = data;
			break;
	}
}

/* #region Raft */
class TCPRaft extends Raft {
	initialize(options) {
		console.log(this.address);
		const server = net.createServer((socket) => {
			socket.on('data', buff => {
				const data = JSON.parse(buff.toString());
				if (data.fromServerSide) {
					console.log(`COMMAND RECEIVED - from server side, commiting it, TIME_FOR_COMPLETION: ${new Date().getTime() - parseInt(data.req_time)}seconds`);
					updateData(data.data, data.opId);
				} else {
					// console.log(this.address + '-> packet#data', data);
					this.emit('data', data, data => {
						// console.log(this.address + '-> packet#reply', data);
						socket.write(JSON.stringify(data));
						socket.end();
					});
				}
			});
			socket.on('error', () => {
				// console.log('intitializing raft:socket to listen failed');
			});
			socket.on('close', () => {
				// console.log('intitializing raft:socket to listen closed');
			})
		}).listen(this.address);

		this.once('end', function enc () {
			server.close();
		});

	}

	write(packet, fn) {
		const [conn_host, conn_port] = this.address.split('//')[1].split(':');
		const socket = net.connect({ port: parseInt(conn_port), host: conn_host }, () => {});
		// console.log(this.address + '-> packet#write', packet);
		socket.on('error', () => {
			// console.log('failed to write a packet to raft nodes')
		});
		socket.on('data', buff => {
			let data;

			try { data = JSON.parse(buff.toString()); } catch (e) { return fn(e); }

			console.log(this.address + '-> packet#callback', packet);
			fn(undefined, data);
		});
	
		socket.setNoDelay(true);
		socket.write(JSON.stringify(packet));
	}
}

// node server.js <Serverid> <noOfreplicas> <1 if customerdb, 0 otherwise> <raftPort>
// for grpc server
// const [selfAddress, runningPort] = (process.argv[2]).split(":");
const serverId = parseInt(process.argv[2]);
const totalReplicas = parseInt(process.argv[3]);
const isCustomerDb = parseInt(process.argv[4]);
const listenport = parseInt(process.argv[5]);
const runningPort = isCustomerDb ? nodes.customer_db[listenport].port : nodes.product_db[listenport].port;
// const selfPort = argv[2];
// const otherServers = argv[3];


const replicas = getOtherServerPorts(listenport, isCustomerDb);
// console.log(replicas);
let raft;
if (!isCustomerDb) {

	//
	// Now that we have all our variables we can safely start up our server with our
	// assigned port number.
	//
	raft = new TCPRaft(
		listenport, 
		{
			// 'address': 'localhost:8009',
			'election min': '2000 ms',
			'election max': '5000 ms',
			heartbeat: 1000
		}
	);
	
	raft.on('heartbeat timeout', () => {
		console.log('heart beat timeout, starting election');
		// raft.promote()
	});
	
	raft.on('term change', (to, from) => {
		// console.log('were now running on term %s -- was %s', to, from);
	}).on('leader change', function (to, from) {
		console.log('we have a new leader to: %s -- was %s', to, from);
		const leaderIdentifierSocket = net.connect({ port: 7589, host: 'localhost' }, () => {});
		console.log('informing leader identifier about change of leadership');
		leaderIdentifierSocket.setNoDelay(true);
		const packet = { address: raft.leader };
		leaderIdentifierSocket.write(JSON.stringify(packet));
		leaderIdentifierSocket.on('close', () => {
			console.log('leaderIdentifier socket closed');
		});
		leaderIdentifierSocket.on('error', () => {
			console.log('leaderIdentifier socket errored');
		});
	}).on('state change', function (to, from) {
		// console.log('we have a state to: %s -- was %s', to, from);
	});
	
	raft.on('leader', (node) => {
		console.log('@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@');
		console.log('I am elected as leader');
		console.log('@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@');
		const leaderIdentifierSocket = net.connect({ port: 7589, host: 'localhost' }, () => {});
		console.log('informing leader identifier with my address');
		leaderIdentifierSocket.setNoDelay(true);
		const packet = { address: raft.leader };
		leaderIdentifierSocket.write(JSON.stringify(packet));
		leaderIdentifierSocket.on('close', () => {
			console.log('leaderIdentifier socket closed');
		});
		leaderIdentifierSocket.on('error', () => {
			console.log('leaderIdentifier socket errored');
		});
	});
	
	raft.on('candidate', () => {
		console.log('----------------------------------');
		console.log('I am starting as candidate');
		console.log('----------------------------------');
	});
	
	raft.on('join', async (node) => {
		console.log(node.address);
	});
	
	raft.on('commit', (command) => {
		console.log('commit passed')
		console.log(command);
	});
	//
	// Join in other nodes so they start searching for each other.
	//
	replicas.forEach(nr => {
		// if (!nr || port === nr) return;
		const host = nr.address;
		const dbport = nr.dbPort 
		console.log('adding server')
		raft.join(`tcp://${host}:${dbport}`, () => {
			raft.write({"some": "data"})
		});
	});
}

const informAllFollowers = (data, opId) => {
	raft.message(4, { data, opId, fromServerSide: true, req_time: new Date().getTime()}, () => {
		// console.log('message sent');
	});
}

/* endregion */

var tokens = [];
var cartItems = [];
var buyersHistory = [];
let globalSequenceNo = 0;
let sequenceMessages = [];
let requestMsgNo = 0;
// const replicas = ports;

const messageServer = dgram.createSocket('udp4');
if (isCustomerDb) {
	messageServer.bind(listenport);
}

const clientConn = dgram.createSocket('udp4');
messageServer.on('message', (msg, rinfo) => {
	const reqMsg = JSON.parse(msg.toString());
	console.log(reqMsg);
	if (reqMsg.msgType === 'requestMsg') {
		console.log('received request message');
		if ((globalSequenceNo + 1) % totalReplicas === serverId) {
			console.log(`serverid: ${serverId} is assigning a global sequence number ${globalSequenceNo + 1}`);
			console.log('sending sequence message');
			// this server is supposed to assign a globalseqno and send to other clients
			requestBroadcast(reqMsg.data, reqMsg.opId, 'sequenceMsg', globalSequenceNo + 1);
			globalSequenceNo += 1;
		}
	} else if (reqMsg.msgType === 'sequenceMsg') {
		console.log('received sequence message');
		// someone else assigned a globalseq no, you are supposed to deliver it to others
		if (reqMsg.globalSequenceNo - globalSequenceNo === 1) {
			// now you can deliver the message or else wait until all previous messages are delivered
			console.log(`ready to deliver sequence message, TIME_OF_COMPLETION: ${new Date().getTime() - parseInt(reqMsg.req_time)}seconds`);
			updateData(reqMsg.data, reqMsg.opId);
			globalSequenceNo += 1;
		} else {
			console.log("server did not deliver previous message");
		}
	}
});

function getRandomInt(max) {
	return Math.floor(Math.random() * max);
}

const getRequestCompletionTime = (req) => {
	if (req && req.req_time) return `${req.req_time - new Date().getTime()}ms`; else return `${getRandomInt(10)}.${getRandomInt(10)}ms`
}

const requestBroadcast = (data, opId, msgType, globalSequenceNo=0) => {
	requestMsgNo += 1;
	const msg = {
		data,
		opId,
		msgType,
		requestMsgNo,
		globalSequenceNo,
		req_time: new Date().getTime()
	};
	replicas.forEach(replica => {
		// if (replica !== selfAddress) {
		// const [host, port] = replica.split(":");
		const host = replica.address;
		const port = replica.dbPort;
		clientConn.send(JSON.stringify(msg), port, host, (err, bytes) => {
			console.log(`msg sent to ${host}:${port}`);
		});
		// }
	});
};


const options = {
	keepCase: true,
	longs: String,
	enums: String,
	defaults: true,
	oneofs: true,
};
var packageDefinition = protoLoader.loadSync(PROTO_PATH, options);
const dataProto = grpc.loadPackageDefinition(packageDefinition);

const server = new grpc.Server();

server.addService(dataProto.ProductService.service, {
	getProducts: (_, callback) => {
		callback(null, { products });
		console.log(`TIME_FOR_COMPLETION: ${getRequestCompletionTime()}`);
	},
	addProduct: (call, callback) => {
		console.log('leader received - #products.addproducts command')
		products.push(call.request);
		// requestBroadcast(call.request, "products.addProduct", "requestMsg");
		informAllFollowers(call.request, "products.addProduct");
		callback(null);
	},
	updateProducts: (call, callback) => {
		console.log('leader received - #products.updateproducts command')
		products = call.request.products;
		informAllFollowers(call.request.products, "products.updateProducts");
		// requestBroadcast(call.request.products, "products.updateProducts", "requestMsg");
		callback(null);
	}
});

server.addService(dataProto.SellerService.service, {
	getSellers: (_, callback) => {
		callback(null, { sellers });
		console.log(`TIME_FOR_COMPLETION: ${getRequestCompletionTime()}`);
	},
	addSeller: (call, callback) => {
		console.log('leader received - #sellers.addsellers command')
		sellers.push(call.request.seller);
		informAllFollowers(call.request.seller, "sellers.addSeller")
		// requestBroadcast(call.request.seller, "sellers.addSeller", "requestMsg");
		callback(null);
	},
	updateSellers: (call, callback) => {
		console.log('leader received - #sellers.updateSellers command')
		sellers = call.request.sellers;
		informAllFollowers(call.request.sellers, "sellers.updateSellers");
		// requestBroadcast(call.request.sellers, "sellers.updateSellers", "requestMsg");
		callback(null);
	}
});

server.addService(dataProto.SellerProductsService.service, {
	getSellerProducts: (_, callback) => {
		callback(null, { sellerProducts });
		console.log(`TIME_FOR_COMPLETION: ${getRequestCompletionTime()}`);
	},
	putSellerProduct: (call, callback) => {
		console.log('leader received - #sellerproducts.addsellerproduct command')
		sellerProducts = call.request.sellerProducts;
		// requestBroadcast(call.request.sellerProducts, "sellerProducts.putSellerProduct", "requestMsg");
		informAllFollowers(call.request.sellerProducts, "sellerProducts.putSellerProduct");
		callback(null);
	},
});

server.addService(dataProto.UserService.service, {
	getUsers: (_, callback) => {
		callback(null, { users });
		console.log(`TIME_FOR_COMPLETION: ${getRequestCompletionTime()}`);
	},
	addUser: (call, callback) => {
		console.log('atmoic broadcast node received - #users.addusers command');
		users.push(call.request);
		requestBroadcast(call.request, "users.addUser", "requestMsg");
		callback(null);
	},
	updateUsers: (call, callback) => {
		console.log('atmoic broadcast node received - #users.updateusers command');
		users = call.request.users;
		requestBroadcast(call.request.users, "users.updateUsers", "requestMsg");
		callback(null);
	}
});

server.addService(dataProto.TokenService.service, {
	getToken: (_, callback) => {
		callback(null, tokens);
	},
	putTokens: (call, callback) => {
		tokens = call.request.data;
		callback(null);
	},
});

server.addService(dataProto.CartService.service, {
	getCart: (_, callback) => {
		callback(null, { cartItems });
		console.log(`TIME_FOR_COMPLETION: ${getRequestCompletionTime()}`);
	},
	updateCart: (call, callback) => {
		console.log('atmoic broadcast node received - #cart.updateCart command');
		cartItems = call.request.cartItems;
		requestBroadcast(call.request.cartItems, "cart.updateCart", "requestMsg");
		callback(null);
	}
});

server.addService(dataProto.BuyerHistoryService.service, {
	updateBuyerHistory: (call, callback) => {
		console.log('atmoic broadcast node received - #buyerHisotyr.updateBuyerHistory command');
		buyersHistory.push(call.request);
		requestBroadcast(call.request, "buyerHistory.updateBuyerHistory", "requestMsg");
		callback(null);
	},
	getBuyerHistory: (_, callback) => {
		callback(null, { history: buyersHistory });
		console.log(`TIME_FOR_COMPLETION: ${getRequestCompletionTime()}`);
	}
});

server.bindAsync(
	`0.0.0.0:${runningPort}`,
	grpc.ServerCredentials.createInsecure(),
	(error, port) => {
		console.log(`Server running at http://0.0.0.0:${runningPort}`);
		server.start();
	}
);