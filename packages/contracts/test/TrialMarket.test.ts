import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Tests for TrialMarket.sol
 *
 * Uses Hardhat's loadFixture for efficient test isolation — each test
 * gets a fresh contract deployment without re-running the full setup.
 *
 * Test structure follows the contract lifecycle:
 *   createMarket → takePosition → requestSettlement → settle/escalate → claimWinnings
 */

describe("TrialMarket", function () {
  // ── Shared fixture: deploys contract and returns test accounts ──

  async function deployFixture() {
    const [owner, alice, bob, charlie] = await ethers.getSigners();
    const TrialMarket = await ethers.getContractFactory("TrialMarket");
    const market = await TrialMarket.deploy();

    // Deadline 1 hour from now
    const deadline = (await time.latest()) + 3600;

    return { market, owner, alice, bob, charlie, deadline };
  }

  // ── Fixture with a market already created ──

  async function marketCreatedFixture() {
    const base = await deployFixture();
    await base.market.createMarket(
      "Did ETH staking yields outperform Treasury rates?",
      "QmRubricHash123",
      base.deadline
    );
    return { ...base, marketId: 0 };
  }

  // ── Fixture with positions taken and settlement requested ──

  async function settlementReadyFixture() {
    const base = await marketCreatedFixture();

    // Alice bets 1 ETH on YES
    await base.market
      .connect(base.alice)
      .takePosition(base.marketId, 1, { value: ethers.parseEther("1.0") }); // 1 = Verdict.Yes

    // Bob bets 0.5 ETH on NO
    await base.market
      .connect(base.bob)
      .takePosition(base.marketId, 2, { value: ethers.parseEther("0.5") }); // 2 = Verdict.No

    // Fast-forward past deadline
    await time.increase(3601);

    // Request settlement
    await base.market.requestSettlement(base.marketId);

    return base;
  }

  // ── createMarket ───────────────────────────────────────────────

  describe("createMarket", function () {
    it("creates a market and emits MarketCreated", async function () {
      const { market, deadline } = await loadFixture(deployFixture);

      await expect(
        market.createMarket("Test question?", "QmHash", deadline)
      )
        .to.emit(market, "MarketCreated")
        .withArgs(0, "Test question?", deadline);

      const m = await market.getMarket(0);
      expect(m.question).to.equal("Test question?");
      expect(m.status).to.equal(0); // MarketStatus.Open
    });

    it("increments market ID for each new market", async function () {
      const { market, deadline } = await loadFixture(deployFixture);

      await market.createMarket("Q1?", "hash1", deadline);
      await market.createMarket("Q2?", "hash2", deadline);

      expect(await market.nextMarketId()).to.equal(2);
    });

    it("reverts if deadline is in the past", async function () {
      const { market } = await loadFixture(deployFixture);
      const pastDeadline = (await time.latest()) - 100;

      await expect(
        market.createMarket("Q?", "hash", pastDeadline)
      ).to.be.revertedWith("Deadline must be in the future");
    });
  });

  // ── takePosition ───────────────────────────────────────────────

  describe("takePosition", function () {
    it("accepts YES positions and updates pool", async function () {
      const { market, alice, marketId } = await loadFixture(
        marketCreatedFixture
      );

      await market
        .connect(alice)
        .takePosition(marketId, 1, { value: ethers.parseEther("1.0") });

      const m = await market.getMarket(marketId);
      expect(m.yesPool).to.equal(ethers.parseEther("1.0"));
      expect(
        await market.yesPositions(marketId, alice.address)
      ).to.equal(ethers.parseEther("1.0"));
    });

    it("accepts NO positions and updates pool", async function () {
      const { market, bob, marketId } = await loadFixture(
        marketCreatedFixture
      );

      await market
        .connect(bob)
        .takePosition(marketId, 2, { value: ethers.parseEther("0.5") });

      const m = await market.getMarket(marketId);
      expect(m.noPool).to.equal(ethers.parseEther("0.5"));
    });

    it("emits PositionTaken event", async function () {
      const { market, alice, marketId } = await loadFixture(
        marketCreatedFixture
      );

      await expect(
        market
          .connect(alice)
          .takePosition(marketId, 1, { value: ethers.parseEther("1.0") })
      )
        .to.emit(market, "PositionTaken")
        .withArgs(marketId, alice.address, 1, ethers.parseEther("1.0"));
    });

    it("allows multiple positions from same user", async function () {
      const { market, alice, marketId } = await loadFixture(
        marketCreatedFixture
      );

      await market
        .connect(alice)
        .takePosition(marketId, 1, { value: ethers.parseEther("1.0") });
      await market
        .connect(alice)
        .takePosition(marketId, 1, { value: ethers.parseEther("0.5") });

      expect(
        await market.yesPositions(marketId, alice.address)
      ).to.equal(ethers.parseEther("1.5"));
    });

    it("reverts with zero value", async function () {
      const { market, alice, marketId } = await loadFixture(
        marketCreatedFixture
      );

      await expect(
        market.connect(alice).takePosition(marketId, 1, { value: 0 })
      ).to.be.revertedWith("Must send ETH");
    });

    it("reverts after deadline", async function () {
      const { market, alice, marketId } = await loadFixture(
        marketCreatedFixture
      );

      await time.increase(3601); // Past deadline

      await expect(
        market
          .connect(alice)
          .takePosition(marketId, 1, { value: ethers.parseEther("1.0") })
      ).to.be.revertedWith("Past deadline");
    });
  });

  // ── requestSettlement ──────────────────────────────────────────

  describe("requestSettlement", function () {
    it("emits SettlementRequested after deadline", async function () {
      const { market, marketId } = await loadFixture(marketCreatedFixture);

      await time.increase(3601);

      await expect(market.requestSettlement(marketId)).to.emit(
        market,
        "SettlementRequested"
      );

      const m = await market.getMarket(marketId);
      expect(m.status).to.equal(1); // MarketStatus.SettlementRequested
    });

    it("reverts before deadline", async function () {
      const { market, marketId } = await loadFixture(marketCreatedFixture);

      await expect(
        market.requestSettlement(marketId)
      ).to.be.revertedWith("Deadline not reached");
    });

    it("reverts if already requested", async function () {
      const { market, marketId } = await loadFixture(marketCreatedFixture);

      await time.increase(3601);
      await market.requestSettlement(marketId);

      await expect(
        market.requestSettlement(marketId)
      ).to.be.revertedWith("Market not open");
    });
  });

  // ── settle ─────────────────────────────────────────────────────

  describe("settle", function () {
    it("resolves market with YES verdict and stores transcript hash", async function () {
      const { market, marketId } = await loadFixture(
        settlementReadyFixture
      );

      const transcriptHash = ethers.keccak256(
        ethers.toUtf8Bytes("trial transcript json")
      );

      await expect(
        market.settle(marketId, 1, 78, 45, transcriptHash) // 1 = Yes
      )
        .to.emit(market, "MarketResolved")
        .withArgs(marketId, 1, 78, 45, transcriptHash);

      const m = await market.getMarket(marketId);
      expect(m.status).to.equal(2); // MarketStatus.Resolved
      expect(m.outcome).to.equal(1); // Verdict.Yes
      expect(m.transcriptHash).to.equal(transcriptHash);
    });

    it("resolves market with NO verdict", async function () {
      const { market, marketId } = await loadFixture(
        settlementReadyFixture
      );

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.settle(marketId, 2, 40, 75, hash); // 2 = No

      const m = await market.getMarket(marketId);
      expect(m.outcome).to.equal(2); // Verdict.No
    });

    it("only callable by owner", async function () {
      const { market, alice, marketId } = await loadFixture(
        settlementReadyFixture
      );

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));

      await expect(
        market.connect(alice).settle(marketId, 1, 78, 45, hash)
      ).to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");
    });

    it("reverts if settlement not requested", async function () {
      const { market } = await loadFixture(marketCreatedFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));

      await expect(
        market.settle(0, 1, 78, 45, hash)
      ).to.be.revertedWith("Settlement not requested");
    });
  });

  // ── escalate ───────────────────────────────────────────────────

  describe("escalate", function () {
    it("escalates market and emits event", async function () {
      const { market, marketId } = await loadFixture(
        settlementReadyFixture
      );

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));

      await expect(market.escalate(marketId, hash))
        .to.emit(market, "MarketEscalated")
        .withArgs(marketId, hash);

      const m = await market.getMarket(marketId);
      expect(m.status).to.equal(3); // MarketStatus.Escalated
    });

    it("only callable by owner", async function () {
      const { market, alice, marketId } = await loadFixture(
        settlementReadyFixture
      );

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));

      await expect(
        market.connect(alice).escalate(marketId, hash)
      ).to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");
    });
  });

  // ── claimWinnings ──────────────────────────────────────────────

  describe("claimWinnings", function () {
    it("pays proportional winnings to YES holders when YES wins", async function () {
      const { market, alice, marketId } = await loadFixture(
        settlementReadyFixture
      );

      // Settle as YES
      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.settle(marketId, 1, 78, 45, hash);

      // Alice bet 1 ETH YES, Bob bet 0.5 ETH NO
      // Alice is the only YES bettor, so she gets entire pool: 1.5 ETH
      const balanceBefore = await ethers.provider.getBalance(alice.address);

      const tx = await market.connect(alice).claimWinnings(marketId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(alice.address);
      const payout = balanceAfter - balanceBefore + gasUsed;

      // Alice should receive 1.5 ETH (her 1 ETH + Bob's 0.5 ETH)
      expect(payout).to.equal(ethers.parseEther("1.5"));
    });

    it("pays proportional winnings to NO holders when NO wins", async function () {
      const { market, bob, marketId } = await loadFixture(
        settlementReadyFixture
      );

      // Settle as NO
      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.settle(marketId, 2, 40, 75, hash);

      const balanceBefore = await ethers.provider.getBalance(bob.address);

      const tx = await market.connect(bob).claimWinnings(marketId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(bob.address);
      const payout = balanceAfter - balanceBefore + gasUsed;

      // Bob bet 0.5 ETH NO, only NO bettor → gets entire pool: 1.5 ETH
      expect(payout).to.equal(ethers.parseEther("1.5"));
    });

    it("splits payout proportionally among multiple winners", async function () {
      const { market, alice, charlie, marketId } = await loadFixture(
        settlementReadyFixture
      );

      // Charlie also bets 1 ETH on YES (in addition to Alice's 1 ETH)
      // Need to go back before deadline for this
      // Use a fresh fixture instead
      const base = await loadFixture(marketCreatedFixture);

      // Alice: 1 ETH YES, Charlie: 2 ETH YES, Bob: 1.5 ETH NO
      await base.market
        .connect(base.alice)
        .takePosition(base.marketId, 1, { value: ethers.parseEther("1.0") });
      await base.market
        .connect(base.charlie)
        .takePosition(base.marketId, 1, { value: ethers.parseEther("2.0") });
      await base.market
        .connect(base.bob)
        .takePosition(base.marketId, 2, { value: ethers.parseEther("1.5") });

      // Fast forward and settle as YES
      await time.increase(3601);
      await base.market.requestSettlement(base.marketId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await base.market.settle(base.marketId, 1, 78, 45, hash);

      // Total pool: 4.5 ETH. YES pool: 3 ETH.
      // Alice's share: (1/3) * 4.5 = 1.5 ETH
      // Charlie's share: (2/3) * 4.5 = 3.0 ETH

      const aliceBefore = await ethers.provider.getBalance(base.alice.address);
      const tx1 = await base.market.connect(base.alice).claimWinnings(base.marketId);
      const r1 = await tx1.wait();
      const aliceAfter = await ethers.provider.getBalance(base.alice.address);
      const alicePayout = aliceAfter - aliceBefore + r1!.gasUsed * r1!.gasPrice;

      expect(alicePayout).to.equal(ethers.parseEther("1.5"));

      const charlieBefore = await ethers.provider.getBalance(base.charlie.address);
      const tx2 = await base.market.connect(base.charlie).claimWinnings(base.marketId);
      const r2 = await tx2.wait();
      const charlieAfter = await ethers.provider.getBalance(base.charlie.address);
      const charliePayout = charlieAfter - charlieBefore + r2!.gasUsed * r2!.gasPrice;

      expect(charliePayout).to.equal(ethers.parseEther("3.0"));
    });

    it("reverts for losers with no winning position", async function () {
      const { market, bob, marketId } = await loadFixture(
        settlementReadyFixture
      );

      // Settle as YES — Bob bet on NO, so he's a loser
      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.settle(marketId, 1, 78, 45, hash);

      await expect(
        market.connect(bob).claimWinnings(marketId)
      ).to.be.revertedWith("No winning position");
    });

    it("prevents double-claim", async function () {
      const { market, alice, marketId } = await loadFixture(
        settlementReadyFixture
      );

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.settle(marketId, 1, 78, 45, hash);

      // First claim succeeds
      await market.connect(alice).claimWinnings(marketId);

      // Second claim reverts — position was zeroed
      await expect(
        market.connect(alice).claimWinnings(marketId)
      ).to.be.revertedWith("No winning position");
    });

    it("reverts if market not resolved", async function () {
      const { market, alice, marketId } = await loadFixture(
        settlementReadyFixture
      );

      // Market is SettlementRequested, not Resolved
      await expect(
        market.connect(alice).claimWinnings(marketId)
      ).to.be.revertedWith("Market not resolved");
    });
  });
});
