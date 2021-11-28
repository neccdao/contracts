const { expect } = require("chai");
const { ethers } = require("hardhat");
const { FakeContract, smock } = require("@defi-wonderland/smock");
const { contractAt } = require("../shared/fixtures");

const TOTAL_GONS = 5000000000000000;
const ZERO_ADDRESS = ethers.utils.getAddress(
  "0x0000000000000000000000000000000000000000"
);

describe("nNecc", () => {
  let deployer;
  let DAO;
  let necc;
  let nNecc;
  let staking;
  let treasury;

  beforeEach(async () => {
    [deployer, DAO] = await ethers.getSigners();
    const diamond = await deployments.fixture([
      "ExchangeDiamond-hardhat",
      "NeccDiamond-hardhat",
    ]);
    const NECC = diamond.NeccDiamond;
    const NNECC = diamond.nNeccDiamond;
    necc = await contractAt("NeccFacet", NECC.address);
    nNecc = await contractAt("nNeccFacet", NNECC.address);
    staking = diamond.BondDepositoryDiamond;
    treasury = diamond.TreasuryDiamond;
  });

  it("is constructed correctly", async () => {
    expect(await nNecc.name()).to.equal("Staked Necc");
    expect(await nNecc.symbol()).to.equal("nNECC");
    expect(await nNecc.decimals()).to.equal(9);
  });

  describe("initialization", () => {
    describe("setIndex", () => {
      it("must be done by the deployer", async () => {
        await expect(nNecc.connect(DAO).setIndex(3)).to.be.reverted;
      });

      it("cannot update the index if already set", async () => {
        await expect(nNecc.connect(deployer).setIndex(3)).to.be.reverted;
      });
    });

    describe("initialize", () => {
      it("assigns TOTAL_GONS to the stakingFake contract's balance", async () => {
        expect(await nNecc.balanceOf(staking.address)).to.equal(TOTAL_GONS);
      });

      it("emits Transfer event", async () => {
        await expect(nNecc.connect(deployer).initialize(staking.address))
          .to.emit(nNecc, "Transfer")
          .withArgs(ZERO_ADDRESS, staking.address, TOTAL_GONS);
      });

      it("emits LogStakingContractUpdated event", async () => {
        await expect(nNecc.connect(deployer).initialize(staking.address))
          .to.emit(nNecc, "LogStakingContractUpdated")
          .withArgs(staking.address);
      });

      it("must be done by the deployer", async () => {
        await expect(nNecc.connect(DAO).initialize(staking.address)).to.be
          .reverted;
      });
    });
  });

  describe("post-initialization", () => {
    beforeEach(async () => {
      // TODO: uncomment when gOhmFake is ready
    });

    describe("approve", () => {
      it("sets the allowed value between sender and spender", async () => {
        await nNecc.connect(DAO).approve(deployer.address, 10);
        expect(await nNecc.allowance(DAO.address, deployer.address)).to.equal(
          10
        );
      });

      it("emits an Approval event", async () => {
        await expect(await nNecc.connect(DAO).approve(deployer.address, 10))
          .to.emit(nNecc, "Approval")
          .withArgs(DAO.address, deployer.address, 10);
      });
    });

    describe("increaseAllowance", () => {
      it("increases the allowance between sender and spender", async () => {
        await nNecc.connect(DAO).approve(deployer.address, 10);
        await nNecc.connect(DAO).increaseAllowance(deployer.address, 4);

        expect(await nNecc.allowance(DAO.address, deployer.address)).to.equal(
          14
        );
      });

      it("emits an Approval event", async () => {
        await nNecc.connect(DAO).approve(deployer.address, 10);
        await expect(
          await nNecc.connect(DAO).increaseAllowance(deployer.address, 4)
        )
          .to.emit(nNecc, "Approval")
          .withArgs(DAO.address, deployer.address, 14);
      });
    });

    describe("decreaseAllowance", () => {
      it("decreases the allowance between sender and spender", async () => {
        await nNecc.connect(DAO).approve(deployer.address, 10);
        await nNecc.connect(DAO).decreaseAllowance(deployer.address, 4);

        expect(await nNecc.allowance(DAO.address, deployer.address)).to.equal(
          6
        );
      });

      it("will not make the value negative", async () => {
        await nNecc.connect(DAO).approve(deployer.address, 10);
        await nNecc.connect(DAO).decreaseAllowance(deployer.address, 11);

        expect(await nNecc.allowance(DAO.address, deployer.address)).to.equal(
          0
        );
      });

      it("emits an Approval event", async () => {
        await nNecc.connect(DAO).approve(deployer.address, 10);
        await expect(
          await nNecc.connect(DAO).decreaseAllowance(deployer.address, 4)
        )
          .to.emit(nNecc, "Approval")
          .withArgs(DAO.address, deployer.address, 6);
      });
    });
  });
});
