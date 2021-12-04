require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");
require("hardhat-contract-sizer");
require("@nomiclabs/hardhat-ethers");
require("hardhat-deploy");
require("hardhat-deploy-ethers");
require("@atixlabs/hardhat-time-n-mine");

const {
  ARBITRUM_MAINNET_URL,
  ARBITRUM_MAINNET_DEPLOY_KEY,
  ARBITRUM_KOVAN_URL,
  ARBITRUM_KOVAN_DEPLOY_KEY,
  RINKEBY_TESTNET_DEPLOY_KEY,
  RINKEBY_TESTNET_DAO_KEY,
  RINKEBY_TESTNET_URL,
  RINKEBY_ETHERSCAN_API_KEY,
} = require("./env.json");

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async () => {
  const accounts = await ethers.getSigners();

  for (const account of accounts) {
    console.info(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  networks: {
    // localhost: {
    //   live: false,
    //   saveDeployments: true,
    //   tags: ["local"],
    // },
    hardhat: {
      chainId: 1337,
      live: false,
      saveDeployments: true,
      tags: ["hardhat"],
      forking: {
        url: "https://mainnet.aurora.dev",
      },
      accounts:
        process.env.NODE_ENV !== "test" && RINKEBY_TESTNET_DAO_KEY
          ? [
              {
                privateKey: RINKEBY_TESTNET_DEPLOY_KEY,
                balance: "40404190888892180000000000000",
              },
              {
                privateKey: RINKEBY_TESTNET_DAO_KEY,
                balance: "40404190888892180000000000000",
              },
            ]
          : undefined,
    },
    rinkeby: {
      live: true,
      saveDeployments: true,
      tags: ["staging"],
      accounts: RINKEBY_TESTNET_DAO_KEY
        ? [RINKEBY_TESTNET_DEPLOY_KEY, RINKEBY_TESTNET_DAO_KEY]
        : [],
      url: RINKEBY_TESTNET_URL,
    },
    // rinkeby: {
    // },

    // arbitrumMainnet: {
    //   url: ARBITRUM_MAINNET_URL,
    //   chainId: 42161,
    //   gasPrice: 0,
    //   accounts: [ARBITRUM_MAINNET_DEPLOY_KEY],
    // },
    // arbitrumKovan: {
    //   url: ARBITRUM_KOVAN_URL,
    //   chainId: 144545313136048,
    //   gasPrice: 0,
    //   accounts: [ARBITRUM_KOVAN_DEPLOY_KEY],
    // },
  },
  // etherscan: {
  //   apiKey: RINKEBY_ETHERSCAN_API_KEY,
  // },
  solidity: {
    compilers: [{ version: "0.8.10" }],
    settings: {
      optimizer: {
        enabled: true,
        runs: 1,
      },
      // for smock
      outputSelection: {
        "*": {
          "*": ["storageLayout"],
        },
      },
    },
  },
  mocha: {
    timeout: 60000,
  },
};
