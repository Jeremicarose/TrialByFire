import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Tests for TrialMarket.sol (with Chainlink integrations)
 *
 * Uses Hardhat's loadFixture for efficient test isolation — each test
 * gets a fresh contract deployment without re-running the full setup.
 *
 * Test structure follows the contract lifecycle:
 *   createMarket → takePosition → requestSettlement →
 *   settle/escalate (manual or via Functions callback) →
 *   claimWinnings/claimRefund
 *
 * Mock contracts (MockFunctionsRouter, MockAggregator) simulate
 * Chainlink infrastructure that only exists on public testnets.
 */

describe("TrialMarket", function () {
  /*
   * CREATION_DEPOSIT must match the constant in TrialMarket.sol.
   * Creating a market requires exactly this much ETH to prevent spam.
   */
  const CREATION_DEPOSIT = ethers.parseEther("0.01");

  // ══════════════════════════════════════════════════════════════
  //  FIXTURES
  // ══════════════════════════════════════════════════════════════

  /**
   * Base fixture: deploys mock Chainlink contracts + TrialMarket.
   *
   * Why deploy mocks first? TrialMarket's constructor requires a
   * valid Functions Router address and Price Feed address. On local
   * Hardhat, we deploy lightweight mocks that implement just enough
   * of the interface to let TrialMarket function.
   */
  async function deployFixture() {
    const [owner, alice, bob, charlie] = await ethers.getSigners();

    // Deploy mock Chainlink contracts
    const MockRouter = await ethers.getContractFactory("MockFunctionsRouter");
    const mockRouter = await MockRouter.deploy();

    const MockFeed = await ethers.getContractFactory("MockAggregator");
    const mockFeed = await MockFeed.deploy();

    // Deploy TrialMarket with mock addresses
    const TrialMarket = await ethers.getContractFactory("TrialMarket");
    const market = await TrialMarket.deploy(
      await mockRouter.getAddress(),
      await mockFeed.getAddress()
    );

    const deadline = (await time.latest()) + 3600; // 1 hour from now

    return { market, mockRouter, mockFeed, owner, alice, bob, charlie, deadline };
  }

  /**
   * Fixture with a market already created.
   * Sends CREATION_DEPOSIT (0.01 ETH) to satisfy the payable requirement.
   */
  async function marketCreatedFixture() {
    const base = await deployFixture();
    await base.market.createMarket(
      "Did ETH staking yields outperform Treasury rates?",
      "QmRubricHash123",
      base.deadline,
      { value: CREATION_DEPOSIT }
    );
    return { ...base, marketId: 0 };
  }

  /**
   * Fixture with positions taken and settlement requested.
   * Alice bets 1 ETH YES, Bob bets 0.5 ETH NO.
   * Time advanced past deadline, settlement requested.
   */
  async function settlementReadyFixture() {
    const base = await marketCreatedFixture();

    await base.market
      .connect(base.alice)
      .takePosition(base.marketId, 1, { value: ethers.parseEther("1.0") });

    await base.market
      .connect(base.bob)
      .takePosition(base.marketId, 2, { value: ethers.parseEther("0.5") });

    await time.increase(3601);
    await base.market.requestSettlement(base.marketId);

    return base;
  }

  // ══════════════════════════════════════════════════════════════
  //  createMarket
  // ══════════════════════════════════════════════════════════════

  describe("createMarket", function () {
    it("creates a market with deposit and emits MarketCreated", async function () {
      const { market, owner, deadline } = await loadFixture(deployFixture);

      await expect(
        market.createMarket("Test question?", "QmHash", deadline, {
          value: CREATION_DEPOSIT,
        })
      )
        .to.emit(market, "MarketCreated")
        .withArgs(0, owner.address, "Test question?", deadline);

      const m = await market.getMarket(0);
      expect(m.question).to.equal("Test question?");
      expect(m.status).to.equal(0); // Open
      expect(m.creator).to.equal(owner.address);
      expect(m.creationDeposit).to.equal(CREATION_DEPOSIT);
    });

    it("anyone can create a market (not just owner)", async function () {
      const { market, alice, deadline } = await loadFixture(deployFixture);

      await expect(
        market.connect(alice).createMarket("Alice's question?", "QmHash", deadline, {
          value: CREATION_DEPOSIT,
        })
      ).to.emit(market, "MarketCreated");

      const m = await market.getMarket(0);
      expect(m.creator).to.equal(alice.address);
    });

    it("increments market ID for each new market", async function () {
      const { market, deadline } = await loadFixture(deployFixture);

      await market.createMarket("Q1?", "h1", deadline, { value: CREATION_DEPOSIT });
      await market.createMarket("Q2?", "h2", deadline, { value: CREATION_DEPOSIT });

      expect(await market.nextMarketId()).to.equal(2);
    });

    it("reverts if deposit is insufficient", async function () {
      const { market, deadline } = await loadFixture(deployFixture);

      await expect(
        market.createMarket("Q?", "hash", deadline, {
          value: ethers.parseEther("0.001"), // Too little
        })
      ).to.be.revertedWith("Must deposit 0.01 ETH");
    });

    it("reverts if deadline is in the past", async function () {
      const { market } = await loadFixture(deployFixture);
      const pastDeadline = (await time.latest()) - 100;

      await expect(
        market.createMarket("Q?", "hash", pastDeadline, { value: CREATION_DEPOSIT })
      ).to.be.revertedWith("Deadline must be in the future");
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  takePosition
  // ══════════════════════════════════════════════════════════════

  describe("takePosition", function () {
    it("accepts YES positions and updates pool", async function () {
      const { market, alice, marketId } = await loadFixture(marketCreatedFixture);

      await market
        .connect(alice)
        .takePosition(marketId, 1, { value: ethers.parseEther("1.0") });

      const m = await market.getMarket(marketId);
      expect(m.yesPool).to.equal(ethers.parseEther("1.0"));
      expect(await market.yesPositions(marketId, alice.address)).to.equal(
        ethers.parseEther("1.0")
      );
    });

    it("accepts NO positions and updates pool", async function () {
      const { market, bob, marketId } = await loadFixture(marketCreatedFixture);

      await market
        .connect(bob)
        .takePosition(marketId, 2, { value: ethers.parseEther("0.5") });

      const m = await market.getMarket(marketId);
      expect(m.noPool).to.equal(ethers.parseEther("0.5"));
    });

    it("emits PositionTaken event", async function () {
      const { market, alice, marketId } = await loadFixture(marketCreatedFixture);

      await expect(
        market.connect(alice).takePosition(marketId, 1, { value: ethers.parseEther("1.0") })
      )
        .to.emit(market, "PositionTaken")
        .withArgs(marketId, alice.address, 1, ethers.parseEther("1.0"));
    });

    it("allows multiple positions from same user", async function () {
      const { market, alice, marketId } = await loadFixture(marketCreatedFixture);

      await market.connect(alice).takePosition(marketId, 1, { value: ethers.parseEther("1.0") });
      await market.connect(alice).takePosition(marketId, 1, { value: ethers.parseEther("0.5") });

      expect(await market.yesPositions(marketId, alice.address)).to.equal(
        ethers.parseEther("1.5")
      );
    });

    it("reverts with zero value", async function () {
      const { market, alice, marketId } = await loadFixture(marketCreatedFixture);

      await expect(
        market.connect(alice).takePosition(marketId, 1, { value: 0 })
      ).to.be.revertedWith("Must send ETH");
    });

    it("reverts after deadline", async function () {
      const { market, alice, marketId } = await loadFixture(marketCreatedFixture);
      await time.increase(3601);

      await expect(
        market.connect(alice).takePosition(marketId, 1, { value: ethers.parseEther("1.0") })
      ).to.be.revertedWith("Past deadline");
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  requestSettlement
  // ══════════════════════════════════════════════════════════════

  describe("requestSettlement", function () {
    it("emits SettlementRequested after deadline", async function () {
      const { market, marketId } = await loadFixture(marketCreatedFixture);
      await time.increase(3601);

      await expect(market.requestSettlement(marketId)).to.emit(
        market,
        "SettlementRequested"
      );

      const m = await market.getMarket(marketId);
      expect(m.status).to.equal(1); // SettlementRequested
    });

    it("reverts before deadline", async function () {
      const { market, marketId } = await loadFixture(marketCreatedFixture);

      await expect(market.requestSettlement(marketId)).to.be.revertedWith(
        "Deadline not reached"
      );
    });

    it("anyone can request settlement (permissionless)", async function () {
      const { market, alice, marketId } = await loadFixture(marketCreatedFixture);
      await time.increase(3601);

      await expect(market.connect(alice).requestSettlement(marketId)).to.emit(
        market,
        "SettlementRequested"
      );
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  settle (manual — owner fallback)
  // ══════════════════════════════════════════════════════════════

  describe("settle (owner)", function () {
    it("resolves market with YES verdict", async function () {
      const { market, marketId } = await loadFixture(settlementReadyFixture);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));

      await expect(market.settle(marketId, 1, 78, 45, hash))
        .to.emit(market, "MarketResolved")
        .withArgs(marketId, 1, 78, 45, hash);

      const m = await market.getMarket(marketId);
      expect(m.status).to.equal(2); // Resolved
      expect(m.outcome).to.equal(1); // Yes
    });

    it("resolves market with NO verdict", async function () {
      const { market, marketId } = await loadFixture(settlementReadyFixture);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));

      await market.settle(marketId, 2, 40, 75, hash);
      const m = await market.getMarket(marketId);
      expect(m.outcome).to.equal(2); // No
    });

    it("only callable by owner", async function () {
      const { market, alice, marketId } = await loadFixture(settlementReadyFixture);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));

      await expect(
        market.connect(alice).settle(marketId, 1, 78, 45, hash)
      ).to.be.revertedWithCustomError(market, "OwnableUnauthorizedAccount");
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  escalate (manual — owner fallback)
  // ══════════════════════════════════════════════════════════════

  describe("escalate (owner)", function () {
    it("escalates market and emits event", async function () {
      const { market, marketId } = await loadFixture(settlementReadyFixture);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));

      await expect(market.escalate(marketId, hash))
        .to.emit(market, "MarketEscalated")
        .withArgs(marketId, hash);

      const m = await market.getMarket(marketId);
      expect(m.status).to.equal(3); // Escalated
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  Chainlink Functions callback (_fulfillRequest)
  // ══════════════════════════════════════════════════════════════

  describe("Chainlink Functions callback", function () {
    /**
     * Tests the full Chainlink Functions flow using the mock router:
     *   1. sendTrialRequest() → router stores request
     *   2. simulateResponse() → router calls handleOracleFulfillment()
     *   3. _fulfillRequest() → contract decodes result and settles
     *
     * This simulates what happens on Sepolia when DON nodes
     * finish executing the trial JavaScript.
     */

    async function functionsReadyFixture() {
      const base = await settlementReadyFixture();

      /*
       * Configure the Functions source code.
       * In tests, we use a dummy source — the mock router doesn't
       * actually execute JavaScript. The real source would be the
       * trial-source.js file that runs on DON nodes.
       */
      await base.market.setDonId(ethers.encodeBytes32String("test-don"));
      await base.market.setSubscriptionId(1);
      await base.market.setFunctionsSource("// mock trial source");

      return base;
    }

    it("resolves market via Functions callback (RESOLVE + YES)", async function () {
      const { market, mockRouter, marketId } = await loadFixture(functionsReadyFixture);

      // Send trial request — stores request ID in mock router
      const tx = await market.sendTrialRequest(marketId);
      const receipt = await tx.wait();

      const requestId = await mockRouter.lastRequestId();

      /*
       * Encode the response as the DON would:
       *   action=1 (RESOLVE), verdict=1 (YES), scoreYes=78, scoreNo=45
       */
      const response = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "uint8", "uint256", "uint256"],
        [1, 1, 78, 45]
      );

      // Simulate DON callback
      await expect(mockRouter.simulateResponse(requestId, response, "0x"))
        .to.emit(market, "MarketResolved");

      const m = await market.getMarket(marketId);
      expect(m.status).to.equal(2); // Resolved
      expect(m.outcome).to.equal(1); // Yes
    });

    it("escalates market via Functions callback (ESCALATE)", async function () {
      const { market, mockRouter, marketId } = await loadFixture(functionsReadyFixture);

      await market.sendTrialRequest(marketId);
      const requestId = await mockRouter.lastRequestId();

      // action=2 (ESCALATE), verdict=0 (doesn't matter), scores
      const response = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint8", "uint8", "uint256", "uint256"],
        [2, 0, 52, 48]
      );

      await expect(mockRouter.simulateResponse(requestId, response, "0x"))
        .to.emit(market, "MarketEscalated");

      const m = await market.getMarket(marketId);
      expect(m.status).to.equal(3); // Escalated
    });

    it("escalates on DON error", async function () {
      const { market, mockRouter, marketId } = await loadFixture(functionsReadyFixture);

      await market.sendTrialRequest(marketId);
      const requestId = await mockRouter.lastRequestId();

      // Simulate an error response (empty response, non-empty error)
      const errorBytes = ethers.toUtf8Bytes("API timeout");

      await expect(mockRouter.simulateResponse(requestId, "0x", errorBytes))
        .to.emit(market, "MarketEscalated");

      const m = await market.getMarket(marketId);
      expect(m.status).to.equal(3); // Escalated
    });

    it("emits TrialRequested with request ID", async function () {
      const { market, marketId } = await loadFixture(functionsReadyFixture);

      await expect(market.sendTrialRequest(marketId))
        .to.emit(market, "TrialRequested");
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  Chainlink Automation (checkUpkeep / performUpkeep)
  // ══════════════════════════════════════════════════════════════

  describe("Chainlink Automation", function () {
    it("checkUpkeep returns false when no markets need settlement", async function () {
      const { market } = await loadFixture(marketCreatedFixture);

      // Market is open but deadline hasn't passed
      const [upkeepNeeded] = await market.checkUpkeep("0x");
      expect(upkeepNeeded).to.be.false;
    });

    it("checkUpkeep returns true when a market is past deadline", async function () {
      const { market, marketId } = await loadFixture(marketCreatedFixture);

      await time.increase(3601); // Past deadline

      const [upkeepNeeded, performData] = await market.checkUpkeep("0x");
      expect(upkeepNeeded).to.be.true;

      // performData should encode the market ID
      const decodedId = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], performData);
      expect(decodedId[0]).to.equal(marketId);
    });

    it("performUpkeep triggers requestSettlement", async function () {
      const { market, marketId } = await loadFixture(marketCreatedFixture);

      await time.increase(3601);

      const performData = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [marketId]);

      await expect(market.performUpkeep(performData))
        .to.emit(market, "SettlementRequested");

      const m = await market.getMarket(marketId);
      expect(m.status).to.equal(1); // SettlementRequested
    });

    it("checkUpkeep ignores already-settled markets", async function () {
      const { market } = await loadFixture(settlementReadyFixture);

      // Market is already SettlementRequested, not Open
      const [upkeepNeeded] = await market.checkUpkeep("0x");
      expect(upkeepNeeded).to.be.false;
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  Chainlink Data Feeds
  // ══════════════════════════════════════════════════════════════

  describe("Chainlink Data Feeds", function () {
    it("returns ETH/USD price from mock feed", async function () {
      const { market } = await loadFixture(deployFixture);

      const [price] = await market.getLatestEthUsdPrice();
      // Mock returns $3,500 (350000000000 with 8 decimals)
      expect(price).to.equal(350000000000n);
    });

    it("reflects updated mock price", async function () {
      const { market, mockFeed } = await loadFixture(deployFixture);

      // Update mock to $4,000
      await mockFeed.setPrice(400000000000n);

      const [price] = await market.getLatestEthUsdPrice();
      expect(price).to.equal(400000000000n);
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  claimWinnings
  // ══════════════════════════════════════════════════════════════

  describe("claimWinnings", function () {
    it("pays proportional winnings to YES holders when YES wins", async function () {
      const { market, alice, marketId } = await loadFixture(settlementReadyFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.settle(marketId, 1, 78, 45, hash);

      /*
       * Alice bet 1 ETH YES, Bob bet 0.5 ETH NO.
       * Total pool: 1.5 ETH. Alice is the only YES bettor.
       * Payout = (1.0 / 1.0) * 1.5 = 1.5 ETH
       */
      const balanceBefore = await ethers.provider.getBalance(alice.address);
      const tx = await market.connect(alice).claimWinnings(marketId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(alice.address);
      const payout = balanceAfter - balanceBefore + gasUsed;

      expect(payout).to.equal(ethers.parseEther("1.5"));
    });

    it("pays proportional winnings to NO holders when NO wins", async function () {
      const { market, bob, marketId } = await loadFixture(settlementReadyFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.settle(marketId, 2, 40, 75, hash);

      const balanceBefore = await ethers.provider.getBalance(bob.address);
      const tx = await market.connect(bob).claimWinnings(marketId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(bob.address);
      const payout = balanceAfter - balanceBefore + gasUsed;

      expect(payout).to.equal(ethers.parseEther("1.5"));
    });

    it("splits payout proportionally among multiple winners", async function () {
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

      await time.increase(3601);
      await base.market.requestSettlement(base.marketId);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await base.market.settle(base.marketId, 1, 78, 45, hash);

      // Total pool: 4.5 ETH. YES pool: 3 ETH.
      // Alice: (1/3) * 4.5 = 1.5 ETH
      const aliceBefore = await ethers.provider.getBalance(base.alice.address);
      const tx1 = await base.market.connect(base.alice).claimWinnings(base.marketId);
      const r1 = await tx1.wait();
      const aliceAfter = await ethers.provider.getBalance(base.alice.address);
      const alicePayout = aliceAfter - aliceBefore + r1!.gasUsed * r1!.gasPrice;
      expect(alicePayout).to.equal(ethers.parseEther("1.5"));

      // Charlie: (2/3) * 4.5 = 3.0 ETH
      const charlieBefore = await ethers.provider.getBalance(base.charlie.address);
      const tx2 = await base.market.connect(base.charlie).claimWinnings(base.marketId);
      const r2 = await tx2.wait();
      const charlieAfter = await ethers.provider.getBalance(base.charlie.address);
      const charliePayout = charlieAfter - charlieBefore + r2!.gasUsed * r2!.gasPrice;
      expect(charliePayout).to.equal(ethers.parseEther("3.0"));
    });

    it("reverts for losers", async function () {
      const { market, bob, marketId } = await loadFixture(settlementReadyFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.settle(marketId, 1, 78, 45, hash);

      await expect(
        market.connect(bob).claimWinnings(marketId)
      ).to.be.revertedWith("No winning position");
    });

    it("prevents double-claim", async function () {
      const { market, alice, marketId } = await loadFixture(settlementReadyFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.settle(marketId, 1, 78, 45, hash);

      await market.connect(alice).claimWinnings(marketId);

      await expect(
        market.connect(alice).claimWinnings(marketId)
      ).to.be.revertedWith("No winning position");
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  claimRefund (escalated markets)
  // ══════════════════════════════════════════════════════════════

  describe("claimRefund", function () {
    it("refunds YES stakers on escalation", async function () {
      const { market, alice, marketId } = await loadFixture(settlementReadyFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.escalate(marketId, hash);

      const balanceBefore = await ethers.provider.getBalance(alice.address);
      const tx = await market.connect(alice).claimRefund(marketId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(alice.address);
      const refund = balanceAfter - balanceBefore + gasUsed;

      // Alice staked 1 ETH on YES — gets exactly 1 ETH back
      expect(refund).to.equal(ethers.parseEther("1.0"));
    });

    it("refunds NO stakers on escalation", async function () {
      const { market, bob, marketId } = await loadFixture(settlementReadyFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.escalate(marketId, hash);

      const balanceBefore = await ethers.provider.getBalance(bob.address);
      const tx = await market.connect(bob).claimRefund(marketId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(bob.address);
      const refund = balanceAfter - balanceBefore + gasUsed;

      // Bob staked 0.5 ETH on NO — gets exactly 0.5 ETH back
      expect(refund).to.equal(ethers.parseEther("0.5"));
    });

    it("emits RefundClaimed event", async function () {
      const { market, alice, marketId } = await loadFixture(settlementReadyFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.escalate(marketId, hash);

      await expect(market.connect(alice).claimRefund(marketId))
        .to.emit(market, "RefundClaimed")
        .withArgs(marketId, alice.address, ethers.parseEther("1.0"));
    });

    it("reverts if market is not escalated", async function () {
      const { market, alice, marketId } = await loadFixture(settlementReadyFixture);

      await expect(
        market.connect(alice).claimRefund(marketId)
      ).to.be.revertedWith("Market not escalated");
    });

    it("prevents double-refund", async function () {
      const { market, alice, marketId } = await loadFixture(settlementReadyFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.escalate(marketId, hash);

      await market.connect(alice).claimRefund(marketId);

      await expect(
        market.connect(alice).claimRefund(marketId)
      ).to.be.revertedWith("No position to refund");
    });
  });

  // ══════════════════════════════════════════════════════════════
  //  claimCreationDeposit
  // ══════════════════════════════════════════════════════════════

  describe("claimCreationDeposit", function () {
    it("refunds deposit after resolution", async function () {
      const { market, owner, marketId } = await loadFixture(settlementReadyFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.settle(marketId, 1, 78, 45, hash);

      const balanceBefore = await ethers.provider.getBalance(owner.address);
      const tx = await market.claimCreationDeposit(marketId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(owner.address);
      const refund = balanceAfter - balanceBefore + gasUsed;

      expect(refund).to.equal(CREATION_DEPOSIT);
    });

    it("refunds deposit after escalation", async function () {
      const { market, owner, marketId } = await loadFixture(settlementReadyFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.escalate(marketId, hash);

      await expect(market.claimCreationDeposit(marketId))
        .to.emit(market, "DepositRefunded")
        .withArgs(marketId, owner.address, CREATION_DEPOSIT);
    });

    it("only creator can claim deposit", async function () {
      const { market, alice, marketId } = await loadFixture(settlementReadyFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.settle(marketId, 1, 78, 45, hash);

      await expect(
        market.connect(alice).claimCreationDeposit(marketId)
      ).to.be.revertedWith("Not market creator");
    });

    it("reverts before settlement", async function () {
      const { market, marketId } = await loadFixture(settlementReadyFixture);

      await expect(
        market.claimCreationDeposit(marketId)
      ).to.be.revertedWith("Market not settled");
    });

    it("prevents double-claim", async function () {
      const { market, marketId } = await loadFixture(settlementReadyFixture);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("transcript"));
      await market.settle(marketId, 1, 78, 45, hash);

      await market.claimCreationDeposit(marketId);

      await expect(
        market.claimCreationDeposit(marketId)
      ).to.be.revertedWith("Deposit already claimed");
    });
  });
});
