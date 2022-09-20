const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { networkConfig, developmentChains } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Raffle Unit Tests", () => {
      let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval
      const chainId = network.config.chainId

      beforeEach(async () => {
        deployer = (await getNamedAccounts()).deployer
        await deployments.fixture(["all"])
        raffle = await ethers.getContract("Raffle", deployer)
        vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
        raffleEntranceFee = await raffle.getEntranceFee()
        interval = await raffle.getInterval()
      })

      describe("constructor", function () {
        it("initializes the raffle correctly", async () => {
          const raffleState = await raffle.getRaffleState()
          assert.equal(raffleState.toString(), "0")
          assert.equal(interval.toString(), networkConfig[chainId]["interval"])
        })
      })

      describe("enterRaffle", () => {
        it("reverts when you dont pay enough", async () => {
          await expect(raffle.enterRaffle()).to.be.revertedWith("Raffle__NotEnoughETHEntered")
        })
        it("records players when they enter", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          const playerFromContract = await raffle.getPlayer(0)
          assert.equal(deployer, playerFromContract)
        })
        it("emits event on enter", async function () {
          await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
            raffle,
            "RaffleEnter"
          )
        })
        it("doesnt allow entrance when raffle is calculating", async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])
          //pretend
          await raffle.performUpkeep([])
          await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
            "Raffle__NotOpen"
          )
        })
      })
      describe("checkUpKeep", () => {
        it("returns false if people havent send any eth", async () => {
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])
          const { upKeepNeeded } = await raffle.callStatic.checkUpkeep([])
          assert(!upKeepNeeded)
        })
        it("returns false if raffle isn't open", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])
          await raffle.performUpkeep("0x")
          const raffleState = await raffle.getRaffleState()
          const { upKeepNeeded } = await raffle.callStatic.checkUpkeep([])
          assert.equal(raffleState.toString(), "1")
          assert.equal(upKeepNeeded, false)
        })
        it("returns false if time hasnt passed", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
          await network.provider.send("evm_mine", [])
          const { upKeepNeeded } = await raffle.callStatic.checkUpkeep([])
          assert(!upKeepNeeded)
        })
        it("returns true if time passed, enough eth, has people, is open", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])
          const { upKeepNeeded } = await raffle.callStatic.checkUpkeep([])
          assert(upKeepNeeded)
        })
      })
      describe("performUpkeep", function () {
        it("can only run if checkUpkeep is true", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.request({ method: "evm_mine", params: [] })
          const tx = await raffle.performUpkeep("0x")
          assert(tx)
        })
        it("reverts when checkUpkeep is false", async () => {
          await expect(raffle.performUpkeep([])).to.be.revertedWith("Raffle__UpKeepNotNeeded")
        })
        it("updates the raffle state, emits the event, calls vrf coordinator", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])
          const TXResponse = await raffle.performUpkeep([])
          const TXReceipt = await TXResponse.wait(1)
          const requestId = TXReceipt.events[1].args.requestId
          const raffleState = await raffle.getRaffleState()
          assert(requestId.toNumber() > 0)
          assert(raffleState == "1")
        })
      })
      describe("fulfillRandomWords", () => {
        beforeEach(async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          await network.provider.send("evm_mine", [])
        })
        it("it can only be called after performUpkeep", async () => {
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
          ).to.be.revertedWith("nonexistent request")
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
          ).to.be.revertedWith("nonexistent request")
        })

        it("picks a winner, resets the lottery, and sends money", async () => {
          const additionalEntrants = 3
          const startingAccountIndex = 1
          const accounts = await ethers.getSigners()
          for (let i = startingAccountIndex; i < startingAccountIndex + additionalEntrants; i++) {
            const accountConnectedRaffle = raffle.connect(accounts[i])
            await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
          }
          const startingTimeStamp = await raffle.getLatestTimeStamp()

          await new Promise(async (resolve, reject) => {
            raffle.once("WinnerPicked", async () => {
              console.log("Found the event")
              try {
                const recentWinner = await raffle.getRecentWinner()
                const raffleState = await raffle.getRaffleState()
                const endingTimeStamp = await raffle.getLatestTimeStamp()
                const numPlayers = await raffle.getNumberOfPlayers()
                const winnerEndingBalance = await accounts[1].getBalance()

                assert.equal(numPlayers.toString(), "0")
                assert.equal(raffleState, "0")
                assert(endingTimeStamp > startingTimeStamp)

                assert.equal(
                  winnerEndingBalance.toString(),
                  winnerStartingBalance.add(
                    raffleEntranceFee.mul(additionalEntrants + 1).toString()
                  )
                )
              } catch (e) {
                reject(e)
              }
              resolve()
            })

            const tx = await raffle.performUpkeep([])
            const txr = await tx.wait(1)
            const winnerStartingBalance = await accounts[1].getBalance()
            await vrfCoordinatorV2Mock.fulfillRandomWords(
              txr.events[1].args.requestId,
              raffle.address
            )
          })
        })
      })
    })
