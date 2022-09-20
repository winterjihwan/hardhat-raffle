const { assert, expect } = require("chai")
const { ethers } = require("hardhat")
const { networkConfig, developmentChains } = require("../../helper-hardhat-config")

developmentChains.includes(network.name)
  ? describe.skip
  : describe("Raffle Staging Test", function () {
      let raffle, raffleEntranceFee, deployer

      beforeEach(async () => {
        deployer = (await getNamedAccounts()).deployer
        raffle = await ethers.getContract("Raffle", deployer)
        raffleEntranceFee = await raffle.getEntranceFee()
      })

      describe("fulfillRandomWords", () => {
        it("works with live Chailnink keepers, VRF, and we get random winner", async () => {
          console.log("Setting up test...")
          const startingTimeStamp = await raffle.getLatestTimeStamp()
          const accounts = await ethers.getSigners()

          console.log("Setting up listener...")
          await new Promise(async (resolve, reject) => {
            raffle.once("WinnerPicked", async () => {
              console.log("WinnerPicked event fired!")
              try {
                const recentWinner = await raffle.getRecentWinner()
                const raffleState = await raffle.getRaffleState()
                const winnerEndingBalance = await accounts[0].getBalance()
                const endingTimeStamp = await raffle.getLatestTimeStamp()

                await expect(raffle.getPlayer(0)).to.be.reverted
                assert.equal(recentWinner.toString(), accounts[0].address)
                assert.equal(raffleState, 0)
                assert.equal(
                  winnerEndingBalance.toString(),
                  winnerStartingBalance.add(raffleEntranceFee).toString()
                )
                assert(endingTimeStamp > startingTimeStamp)
                resolve()
              } catch (e) {
                console.log(e)
                reject(e)
              }
            })
            console.log("Entering raffle...")
            const tx = await raffle.enterRaffle({ value: raffleEntranceFee + 1 })
            await tx.wait(1)
            console.log("time to wait...")
            const winnerStartingBalance = await accounts[0].getBalance()
          })
        })
      })
    })
