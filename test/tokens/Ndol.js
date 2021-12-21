const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract, contractAt } = require("../shared/fixtures");
const {
  expandDecimals,
  getBlockTime,
  increaseTime,
  mineBlock,
  reportGasUsed,
} = require("../shared/utilities");
const { deployments } = require("hardhat");
const { ethers } = require("ethers");

use(solidity);

describe("NDOL", function () {
  const provider = waffle.provider;
  const [deployer, user0, user1, user2, user3] = provider.getWallets();
  let ndol;
  let diamond;

  beforeEach(async () => {
    diamond = await deployments.fixture(["ExchangeDiamond-hardhat"]);
    exchangeDiamond = diamond.ExchangeDiamond;
    ndol = diamond.NdolDiamond;
    ndol = await contractAt("NdolFacet", ndol.address);
  });

  it("addVault", async () => {
    const { execute, deploy } = deployments;
    await expect(
      ndol.connect(user0).addVault(user0.address)
    ).to.be.revertedWith("LibDiamond: invalid contract owner");

    await ndol.setGov(user0.address);

    expect(await ndol.vaults(user0.address)).eq(false);
    await ndol.connect(user0).addVault(user0.address);
    expect(await ndol.vaults(user0.address)).eq(true);
  });

  it("removeVault", async () => {
    await expect(
      ndol.connect(user0).removeVault(user0.address)
    ).to.be.revertedWith("LibDiamond: invalid contract owner");

    await ndol.setGov(user0.address);

    expect(await ndol.vaults(user0.address)).eq(false);
    await ndol.connect(user0).addVault(user0.address);
    expect(await ndol.vaults(user0.address)).eq(true);
    await ndol.connect(user0).removeVault(user0.address);
    expect(await ndol.vaults(user0.address)).eq(false);
  });

  it("mint", async () => {
    expect(await ndol.balanceOf(deployer.address)).eq(0);
    await ndol.addVault(deployer.address);
    await ndol.connect(deployer).mint(deployer.address, 1000);
    expect(await ndol.balanceOf(deployer.address)).eq(1000);
    expect(await ndol.totalSupply()).eq(1000);

    await expect(
      ndol.connect(user0).mint(deployer.address, 1000)
    ).to.be.revertedWith("NDOL: only vaults");

    await ndol.addVault(user0.address);

    expect(await ndol.balanceOf(deployer.address)).eq(1000);
    await ndol.connect(user0).mint(deployer.address, 500);
    expect(await ndol.balanceOf(deployer.address)).eq(1500);
    expect(await ndol.totalSupply()).eq(1500);
  });

  it("burn", async () => {
    expect(await ndol.balanceOf(deployer.address)).eq(0);
    await ndol.addVault(deployer.address);
    await ndol.connect(deployer).mint(deployer.address, 1000);
    expect(await ndol.balanceOf(deployer.address)).eq(1000);
    await ndol.connect(deployer).burn(deployer.address, 300);
    expect(await ndol.balanceOf(deployer.address)).eq(700);
    expect(await ndol.totalSupply()).eq(700);

    await expect(
      ndol.connect(user0).burn(deployer.address, 100)
    ).to.be.revertedWith("NDOL: only vaults");

    await ndol.addVault(user0.address);

    await ndol.connect(user0).burn(deployer.address, 100);
    expect(await ndol.balanceOf(deployer.address)).eq(600);
    expect(await ndol.totalSupply()).eq(600);
  });
});
