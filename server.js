const grpc = require("@grpc/grpc-js");
const PROTO_PATH = "./data.proto";
var protoLoader = require("@grpc/proto-loader");
var products = require('./data/products.json');
var sellers = require('./data/sellers.json');
var sellerProducts = require('./data/seller_products.json');
var users = require('./data/users.json');
var tokens = [];
var cartItems = [];
var buyersHistory = [];

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
	},
	addProduct: (call, callback) => {
		products.push(call.request);
		callback(null);
	},
	updateProducts: (call, callback) => {
		products = call.request.products;
		callback(null);
	}
});

server.addService(dataProto.SellerService.service, {
	getSellers: (_, callback) => {
		callback(null, { sellers });
	},
	addSeller: (call, callback) => {
		sellers.push(call.request.seller);
		callback(null);
	},
	updateSellers: (call, callback) => {
		sellers = call.request.sellers;
		callback(null);
	}
});

server.addService(dataProto.SellerProductsService.service, {
	getSellerProducts: (_, callback) => {
		callback(null, { sellerProducts });
	},
	putSellerProduct: (call, callback) => {
		sellerProducts = call.request.sellerProducts;
		callback(null);
	},
});

server.addService(dataProto.UserService.service, {
	getUsers: (_, callback) => {
		callback(null, { users });
	},
	addUser: (call, callback) => {
		users.push(call.request);
		callback(null);
	},
	updateUsers: (call, callback) => {
		users = call.request.users;
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
	},
	updateCart: (call, callback) => {
		cartItems = call.request.cartItems;
		callback(null);
	}
});

server.addService(dataProto.BuyerHistoryService.service, {
	updateBuyerHistory: (call, callback) => {
		console.log(call.request);
		buyersHistory.push(call.request);
		callback(null);
	},
	getBuyerHistory: (_, callback) => {
		callback(null, { history: buyersHistory });
	}
})
  
server.bindAsync(
	"0.0.0.0:5000",
	grpc.ServerCredentials.createInsecure(),
	(error, port) => {
		console.log("Server running at http://127.0.0.1:50051");
		server.start();
	}
);