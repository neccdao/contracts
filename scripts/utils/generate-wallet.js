const { ethers } = require("ethers");

const { publicKey, address, privateKey } = ethers.Wallet.createRandom();
console.log({ publicKey, address, privateKey });
