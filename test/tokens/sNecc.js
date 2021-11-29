const { expect } = require("chai");
const { ethers } = require("hardhat");
const { FakeContract, smock } = require("@defi-wonderland/smock");
const { contractAt } = require("../shared/fixtures");

const TOTAL_GONS = 5000000000000000;
const ZERO_ADDRESS = ethers.utils.getAddress(
  "0x0000000000000000000000000000000000000000"
);

describe("sNecc", () => {
  let deployer;
  let DAO;
  let necc;
  let sNecc;
  let staking;
  let treasury;

  beforeEach(async () => {
    [deployer, DAO] = await ethers.getSigners();
    const diamond = await deployments.fixture([
      "ExchangeDiamond-hardhat",
      "NeccDiamond-hardhat",
    ]);
    const NECC = diamond.NeccDiamond;
    const NNECC = diamond.sNeccDiamond;
    necc = await contractAt("NeccFacet", NECC.address);
    sNecc = await contractAt("sNeccFacet", NNECC.address);
    staking = diamond.BondDepositoryDiamond;
    treasury = diamond.TreasuryDiamond;
  });

  it("is constructed correctly", async () => {
    expect(await sNecc.name()).to.equal("Staked Necc");
    expect(await sNecc.symbol()).to.equal("sNECC");
    expect(await sNecc.decimals()).to.equal(9);
  });

  describe("initialization", () => {
    describe("setIndex", () => {
      it("must be done by the deployer", async () => {
        await expect(sNecc.connect(DAO).setIndex(3)).to.be.reverted;
      });

      it("cannot update the index if already set", async () => {
        await expect(sNecc.connect(deployer).setIndex(3)).to.be.reverted;
      });
    });

    describe("initialize", () => {
      it("assigns TOTAL_GONS to the stakingFake contract's balance", async () => {
        expect(await sNecc.balanceOf(staking.address)).to.equal(TOTAL_GONS);
      });

      it("emits Transfer event", async () => {
        await expect(sNecc.connect(deployer).initialize(staking.address))
          .to.emit(sNecc, "Transfer")
          .withArgs(ZERO_ADDRESS, staking.address, TOTAL_GONS);
      });

      it("emits LogStakingContractUpdated event", async () => {
        await expect(sNecc.connect(deployer).initialize(staking.address))
          .to.emit(sNecc, "LogStakingContractUpdated")
          .withArgs(staking.address);
      });

      it("must be done by the deployer", async () => {
        await expect(sNecc.connect(DAO).initialize(staking.address)).to.be
          .reverted;
      });
    });
  });

  describe("post-initialization", () => {
    beforeEach(async () => {
      // TODO: uncomment when nNeccFake is ready
    });

    describe("approve", () => {
      it("sets the allowed value between sender and spender", async () => {
        await sNecc.connect(DAO).approve(deployer.address, 10);
        expect(await sNecc.allowance(DAO.address, deployer.address)).to.equal(
          10
        );
      });

      it("emits an Approval event", async () => {
        await expect(await sNecc.connect(DAO).approve(deployer.address, 10))
          .to.emit(sNecc, "Approval")
          .withArgs(DAO.address, deployer.address, 10);
      });
    });

    describe("increaseAllowance", () => {
      it("increases the allowance between sender and spender", async () => {
        await sNecc.connect(DAO).approve(deployer.address, 10);
        await sNecc.connect(DAO).increaseAllowance(deployer.address, 4);

        expect(await sNecc.allowance(DAO.address, deployer.address)).to.equal(
          14
        );
      });

      it("emits an Approval event", async () => {
        await sNecc.connect(DAO).approve(deployer.address, 10);
        await expect(
          await sNecc.connect(DAO).increaseAllowance(deployer.address, 4)
        )
          .to.emit(sNecc, "Approval")
          .withArgs(DAO.address, deployer.address, 14);
      });
    });

    describe("decreaseAllowance", () => {
      it("decreases the allowance between sender and spender", async () => {
        await sNecc.connect(DAO).approve(deployer.address, 10);
        await sNecc.connect(DAO).decreaseAllowance(deployer.address, 4);

        expect(await sNecc.allowance(DAO.address, deployer.address)).to.equal(
          6
        );
      });

      it("will not make the value negative", async () => {
        await sNecc.connect(DAO).approve(deployer.address, 10);
        await sNecc.connect(DAO).decreaseAllowance(deployer.address, 11);

        expect(await sNecc.allowance(DAO.address, deployer.address)).to.equal(
          0
        );
      });

      it("emits an Approval event", async () => {
        await sNecc.connect(DAO).approve(deployer.address, 10);
        await expect(
          await sNecc.connect(DAO).decreaseAllowance(deployer.address, 4)
        )
          .to.emit(sNecc, "Approval")
          .withArgs(DAO.address, deployer.address, 6);
      });
    });
  });
});
