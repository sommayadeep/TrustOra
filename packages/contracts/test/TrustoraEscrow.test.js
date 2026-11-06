import { expect } from "chai";
import { network } from "hardhat";

describe("TrustoraEscrow Smart Contract", function () {
  let ethers;
  let escrow;
  let usdc;
  let owner;
  let client;
  let freelancer;
  let arbiter;
  let unauthorizedAgent;

  let PROJECT_ID;
  let CRITERIA_HASH;
  let DELIVERABLE_HASH;
  const DELIVERABLE_URI = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
  const MILESTONE_AMOUNT = 500n * 10n ** 6n; // 500 USDC (6 decimals)

  before(async function () {
    ({ ethers } = await network.create());
    PROJECT_ID = ethers.encodeBytes32String("TRU-PROJ-2026-001");
    CRITERIA_HASH = ethers.keccak256(ethers.toUtf8Bytes("Acceptance Criteria v1.0"));
    DELIVERABLE_HASH = ethers.keccak256(ethers.toUtf8Bytes("Deliverable Bundle v1.0"));
  });

  beforeEach(async function () {
    [owner, client, freelancer, arbiter, unauthorizedAgent] = await ethers.getSigners();

    // Deploy Mock USDC with 6 decimals
    const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDCFactory.deploy();
    await usdc.waitForDeployment();

    // Deploy TrustoraEscrow
    const EscrowFactory = await ethers.getContractFactory("TrustoraEscrow");
    escrow = await EscrowFactory.deploy(await usdc.getAddress());
    await escrow.waitForDeployment();

    // Fund client with 5,000 USDC
    await usdc.mint(client.address, 5000n * 10n ** 6n);
    // Client approves escrow contract
    await usdc.connect(client).approve(await escrow.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment & Configuration", function () {
    it("should initialize with correct USDC token address and owner", async function () {
      expect(await escrow.usdcToken()).to.equal(await usdc.getAddress());
      expect(await escrow.owner()).to.equal(owner.address);
    });

    it("should revert if USDC address is zero", async function () {
      const EscrowFactory = await ethers.getContractFactory("TrustoraEscrow");
      await expect(EscrowFactory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        escrow,
        "InvalidAddress"
      );
    });
  });

  describe("Project Creation", function () {
    it("should successfully register a project", async function () {
      await expect(escrow.connect(client).createProject(PROJECT_ID, freelancer.address, arbiter.address))
        .to.emit(escrow, "ProjectCreated")
        .withArgs(PROJECT_ID, client.address, freelancer.address, arbiter.address, (val) => val > 0);

      const proj = await escrow.getProject(PROJECT_ID);
      expect(proj.client).to.equal(client.address);
      expect(proj.freelancer).to.equal(freelancer.address);
      expect(proj.arbiter).to.equal(arbiter.address);
      expect(proj.exists).to.be.true;
    });

    it("should revert if freelancer address is zero or equals client", async function () {
      await expect(
        escrow.connect(client).createProject(PROJECT_ID, ethers.ZeroAddress, arbiter.address)
      ).to.be.revertedWithCustomError(escrow, "InvalidAddress");

      await expect(
        escrow.connect(client).createProject(PROJECT_ID, client.address, arbiter.address)
      ).to.be.revertedWithCustomError(escrow, "InvalidAddress");
    });

    it("should revert on duplicate project creation", async function () {
      await escrow.connect(client).createProject(PROJECT_ID, freelancer.address, arbiter.address);
      await expect(
        escrow.connect(client).createProject(PROJECT_ID, freelancer.address, arbiter.address)
      ).to.be.revertedWithCustomError(escrow, "ProjectAlreadyExists");
    });
  });

  describe("Milestone Addition and USDC Funding", function () {
    beforeEach(async function () {
      await escrow.connect(client).createProject(PROJECT_ID, freelancer.address, arbiter.address);
    });

    it("should add a milestone in Unfunded state", async function () {
      await expect(escrow.connect(client).addMilestone(PROJECT_ID, CRITERIA_HASH, MILESTONE_AMOUNT))
        .to.emit(escrow, "MilestoneAdded")
        .withArgs(PROJECT_ID, 1n, CRITERIA_HASH, MILESTONE_AMOUNT);

      const milestone = await escrow.getMilestone(PROJECT_ID, 1);
      expect(milestone.id).to.equal(1n);
      expect(milestone.amount).to.equal(MILESTONE_AMOUNT);
      expect(milestone.state).to.equal(0); // Unfunded
    });

    it("should successfully fund milestone with 6-decimal USDC", async function () {
      await escrow.connect(client).addMilestone(PROJECT_ID, CRITERIA_HASH, MILESTONE_AMOUNT);

      const initialClientBalance = await usdc.balanceOf(client.address);
      const initialEscrowBalance = await usdc.balanceOf(await escrow.getAddress());

      await expect(escrow.connect(client).fundMilestone(PROJECT_ID, 1))
        .to.emit(escrow, "MilestoneFunded")
        .withArgs(PROJECT_ID, 1n, client.address, MILESTONE_AMOUNT, (val) => val > 0);

      const finalClientBalance = await usdc.balanceOf(client.address);
      const finalEscrowBalance = await usdc.balanceOf(await escrow.getAddress());

      expect(initialClientBalance - finalClientBalance).to.equal(MILESTONE_AMOUNT);
      expect(finalEscrowBalance - initialEscrowBalance).to.equal(MILESTONE_AMOUNT);

      const milestone = await escrow.getMilestone(PROJECT_ID, 1);
      expect(milestone.state).to.equal(1); // Funded
    });
  });

  describe("Deliverable Submission & Revision Cycle", function () {
    beforeEach(async function () {
      await escrow.connect(client).createProject(PROJECT_ID, freelancer.address, arbiter.address);
      await escrow.connect(client).addMilestone(PROJECT_ID, CRITERIA_HASH, MILESTONE_AMOUNT);
      await escrow.connect(client).fundMilestone(PROJECT_ID, 1);
    });

    it("should allow freelancer to submit deliverable", async function () {
      await expect(
        escrow
          .connect(freelancer)
          .submitMilestoneWork(PROJECT_ID, 1, DELIVERABLE_HASH, DELIVERABLE_URI)
      )
        .to.emit(escrow, "MilestoneSubmitted")
        .withArgs(PROJECT_ID, 1n, freelancer.address, DELIVERABLE_HASH, DELIVERABLE_URI, (val) => val > 0);

      const milestone = await escrow.getMilestone(PROJECT_ID, 1);
      expect(milestone.state).to.equal(2); // Submitted
      expect(milestone.deliverableHash).to.equal(DELIVERABLE_HASH);
    });

    it("should allow client to request revision", async function () {
      await escrow.connect(freelancer).submitMilestoneWork(PROJECT_ID, 1, DELIVERABLE_HASH, DELIVERABLE_URI);

      await expect(escrow.connect(client).requestRevision(PROJECT_ID, 1, "Please fix mobile layout"))
        .to.emit(escrow, "RevisionRequested")
        .withArgs(PROJECT_ID, 1n, client.address, "Please fix mobile layout");

      const milestone = await escrow.getMilestone(PROJECT_ID, 1);
      expect(milestone.state).to.equal(3); // RevisionRequested
    });
  });

  describe("Conditional Payment Release & Safety Invariants", function () {
    beforeEach(async function () {
      await escrow.connect(client).createProject(PROJECT_ID, freelancer.address, arbiter.address);
      await escrow.connect(client).addMilestone(PROJECT_ID, CRITERIA_HASH, MILESTONE_AMOUNT);
      await escrow.connect(client).fundMilestone(PROJECT_ID, 1);
      await escrow.connect(freelancer).submitMilestoneWork(PROJECT_ID, 1, DELIVERABLE_HASH, DELIVERABLE_URI);
    });

    it("should reject release before the freelancer submits work", async function () {
      const fundedProjectId = ethers.encodeBytes32String("TRU-PROJ-2026-002");
      await escrow.connect(client).createProject(fundedProjectId, freelancer.address, arbiter.address);
      await escrow.connect(client).addMilestone(fundedProjectId, CRITERIA_HASH, MILESTONE_AMOUNT);
      await escrow.connect(client).fundMilestone(fundedProjectId, 1);
      await expect(
        escrow.connect(client).releaseMilestone(fundedProjectId, 1)
      ).to.be.revertedWithCustomError(escrow, "InvalidStateTransition");
    });

    it("CRITICAL: AI or unauthorized agent CANNOT release escrow funds", async function () {
      // An unauthorized agent / AI model attempting to call releaseMilestone must revert
      await expect(
        escrow.connect(unauthorizedAgent).releaseMilestone(PROJECT_ID, 1)
      ).to.be.revertedWithCustomError(escrow, "OnlyClientAllowed");

      // Freelancer cannot release funds to themselves either
      await expect(
        escrow.connect(freelancer).releaseMilestone(PROJECT_ID, 1)
      ).to.be.revertedWithCustomError(escrow, "OnlyClientAllowed");
    });

    it("should allow client to approve and release USDC to freelancer", async function () {
      const initialFreelancerBalance = await usdc.balanceOf(freelancer.address);

      await expect(escrow.connect(client).releaseMilestone(PROJECT_ID, 1))
        .to.emit(escrow, "MilestoneReleased")
        .withArgs(PROJECT_ID, 1n, freelancer.address, MILESTONE_AMOUNT, (val) => val > 0);

      const finalFreelancerBalance = await usdc.balanceOf(freelancer.address);
      expect(finalFreelancerBalance - initialFreelancerBalance).to.equal(MILESTONE_AMOUNT);

      const milestone = await escrow.getMilestone(PROJECT_ID, 1);
      expect(milestone.state).to.equal(5); // Released
    });
  });

  describe("Dispute Resolution & Refunds", function () {
    beforeEach(async function () {
      await escrow.connect(client).createProject(PROJECT_ID, freelancer.address, arbiter.address);
      await escrow.connect(client).addMilestone(PROJECT_ID, CRITERIA_HASH, MILESTONE_AMOUNT);
      await escrow.connect(client).fundMilestone(PROJECT_ID, 1);
      await escrow.connect(freelancer).submitMilestoneWork(PROJECT_ID, 1, DELIVERABLE_HASH, DELIVERABLE_URI);
    });

    it("should allow either party to open a dispute", async function () {
      await expect(escrow.connect(client).disputeMilestone(PROJECT_ID, 1, "Milestone incomplete"))
        .to.emit(escrow, "MilestoneDisputed")
        .withArgs(PROJECT_ID, 1n, client.address, "Milestone incomplete", (val) => val > 0);

      const milestone = await escrow.getMilestone(PROJECT_ID, 1);
      expect(milestone.state).to.equal(6); // Disputed
    });

    it("should allow designated arbiter to resolve dispute with a split", async function () {
      await escrow.connect(client).disputeMilestone(PROJECT_ID, 1, "Dispute opened");

      const freelancerShare = 300n * 10n ** 6n;
      const clientShare = 200n * 10n ** 6n;

      const clientBefore = await usdc.balanceOf(client.address);
      const freelancerBefore = await usdc.balanceOf(freelancer.address);

      await expect(escrow.connect(arbiter).resolveDispute(PROJECT_ID, 1, freelancerShare, clientShare))
        .to.emit(escrow, "DisputeResolved")
        .withArgs(PROJECT_ID, 1n, arbiter.address, freelancerShare, clientShare, (val) => val > 0);

      const clientAfter = await usdc.balanceOf(client.address);
      const freelancerAfter = await usdc.balanceOf(freelancer.address);

      expect(freelancerAfter - freelancerBefore).to.equal(freelancerShare);
      expect(clientAfter - clientBefore).to.equal(clientShare);
    });

    it("should allow freelancer to voluntarily refund", async function () {
      const clientBefore = await usdc.balanceOf(client.address);

      await expect(escrow.connect(freelancer).refundMilestone(PROJECT_ID, 1))
        .to.emit(escrow, "MilestoneRefunded")
        .withArgs(PROJECT_ID, 1n, client.address, MILESTONE_AMOUNT, (val) => val > 0);

      const clientAfter = await usdc.balanceOf(client.address);
      expect(clientAfter - clientBefore).to.equal(MILESTONE_AMOUNT);
    });
  });
});
