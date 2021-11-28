const { expect } = require("chai");
const { deployments, ethers } = require("hardhat");
const { contractAt } = require("../shared/fixtures");

describe("Necc", () => {
  let deployer;
  let vault;
  let bob;
  let alice;
  let necc;

  beforeEach(async () => {
    [deployer, vault, bob, alice] = await ethers.getSigners();
    const { execute, deploy } = deployments;

    const diamond = await deployments.fixture([
      "ExchangeDiamond-hardhat",
      "NeccDiamond-hardhat",
    ]);
    const NECC = diamond.NeccDiamond;
    necc = await contractAt("NeccFacet", NECC.address);
  });

  it("correctly constructs an ERC20", async () => {
    expect(await necc.name()).to.equal("Necc");
    expect(await necc.symbol()).to.equal("NECC");
    expect(await necc.decimals()).to.equal(9);
  });

  describe("mint", () => {
    it("must be done by vault", async () => {
      await expect(necc.connect(deployer).mint(vault.address, 100)).to.be
        .reverted;
    });

    it("increases total supply", async () => {
      let supplyBefore = await necc.totalSupply();
      await necc.connect(vault).mint(vault.address, 100);
      expect(supplyBefore.add(100)).to.equal(await necc.totalSupply());
    });
  });

  describe("burn", () => {
    beforeEach(async () => {
      await necc.connect(vault).mint(vault.address, 100);
    });

    it("reduces the total supply", async () => {
      let supplyBefore = await necc.totalSupply();
      await necc.connect(vault).burn(10);
      expect(supplyBefore.sub(10)).to.equal(await necc.totalSupply());
    });

    it("cannot exceed total supply", async () => {
      let supply = await necc.totalSupply();
      await expect(necc.connect(vault).burn(supply.add(1))).to.be.revertedWith(
        "ERC20: burn amount exceeds balance"
      );
    });

    it("cannot exceed vault's balance", async () => {
      let vaultBalance = await necc.balanceOf(vault.address);
      await expect(
        necc.connect(vault).burn(vaultBalance.add(1))
      ).to.be.revertedWith("ERC20: burn amount exceeds balance");
    });
  });
});
