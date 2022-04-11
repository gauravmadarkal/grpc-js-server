const nodes = require('./nodes.json');

const getOtherServerPorts = (port, isCustomerDb) => {
	const otherPorts = []
	let currPort = port;
	let maxPort = isCustomerDb ? 7004 : 8004
	let minPort = isCustomerDb ? 7000 : 8000
	const portData = isCustomerDb ? nodes['customer_db'] : nodes['product_db'];
	for (let i = 1; i < 5; i++) {
		currPort += 1;
		if (currPort > maxPort) {
			otherPorts.push(portData[minPort]);
			currPort = minPort;
		} else {
			otherPorts.push(portData[currPort]);
		}
	}
	return otherPorts;
};

module.exports = {getOtherServerPorts}