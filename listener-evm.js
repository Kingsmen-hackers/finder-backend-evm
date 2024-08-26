const mongoose = require("mongoose");
const RequestModel = require("./models/Request.model");
const LastBlockModel = require("./models/LastBlock.model");
const OfferModel = require("./models/Offer.model");
const UserCreatedModel = require("./models/UserCreated.model");
const { web3, matchContract } = require("./evm_base");

require("dotenv").config();

function connectWithRetry() {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => {
      console.log("Connected to Database");
    })
    .catch((err) => {
      console.error(
        "Failed to connect to MongoDB, retrying in 5 seconds...",
        err
      );
      setTimeout(connectWithRetry, 5000);
    });
  mongoose.set("debug", process.env.NODE_ENV != "production");
}

connectWithRetry();

const getMarketPlaceEvents = async () => {
  try {
    let latestBlockNumber = await web3.eth.getBlockNumber();

    let _lastScannedBlock = await LastBlockModel.findOne(
      { blockNumber: { $ne: 0 } },
      {},
      {
        upsert: true,
      }
    );
    if (!_lastScannedBlock) {
      _lastScannedBlock = await LastBlockModel.create({
        blockNumber: +process.env.START_BLOCK_NUMBER,
      });
    }
    let lastScannedBlock = _lastScannedBlock.blockNumber;
    let lastScannedBlockOffset = lastScannedBlock + 2000;

    if (lastScannedBlockOffset > latestBlockNumber) {
      lastScannedBlockOffset = latestBlockNumber;
    }
    const option = {
      latestBlockNumber: lastScannedBlockOffset,
      lastScannedBlock,
    };

    await processRequestCreated(option);
    await processOfferCreated(option);
    await processRequestAccepted(option);
    await processOfferAccepted(option);
    await processUserCreated(option);

    lastScannedBlock = lastScannedBlockOffset;

    await LastBlockModel.updateOne(
      {
        blockNumber: { $ne: 0 },
      },
      {
        blockNumber: lastScannedBlockOffset,
      },
      {
        upsert: true,
      }
    );
  } catch (error) {
    console.log(error.message);
  }
};

const processRequestCreated = async ({
  latestBlockNumber,
  lastScannedBlock,
}) => {
  const events = await matchContract.getPastEvents("RequestCreated", {
    fromBlock: lastScannedBlock + 1,
    toBlock: latestBlockNumber,
  });

  // Process the events
  events.forEach(async (event) => {
    const address = event.address;
    const transactionHash = event.transactionHash;
    const eventName = event.event;
    const signature = event.signature;
    const {
      requestId,
      buyerAddress,
      images,
      lifecycle,
      requestName,
      description,
      latitude,
      longitude,
      buyerId,
      sellerIds,
      sellersPriceQuote,
      lockedSellerId,
      createdAt,
      updatedAt,
    } = event.returnValues;

    // get timestamp from block
    const block = await web3.eth.getBlock(event.blockNumber);
    event.timestamp = block.timestamp;

    const result = await RequestModel.updateOne(
      { transactionHash },
      {
        address,
        transactionHash,
        eventName,
        signature,
        requestId,
        buyerAddress,
        images,
        lifecycle,
        requestName,
        description,
        latitude,
        longitude,
        buyerId,
        sellerIds,
        sellersPriceQuote,
        lockedSellerId,
        createdAt,
        updatedAt,
      },
      {
        upsert: true,
      }
    );
    console.log(result);
  });
};
const processOfferCreated = async ({ latestBlockNumber, lastScannedBlock }) => {
  const events = await matchContract.getPastEvents("OfferCreated", {
    fromBlock: lastScannedBlock + 1,
    toBlock: latestBlockNumber,
  });

  // Process the events
  events.forEach(async (event) => {
    const address = event.address;
    const transactionHash = event.transactionHash;
    const eventName = event.event;
    const signature = event.signature;
    const {
      offerId,
      sellerAddress,
      storeName,
      price,
      requestId,
      images,
      sellerId,
      sellerIds,
    } = event.returnValues;

    // get timestamp from block
    const block = await web3.eth.getBlock(event.blockNumber);
    event.timestamp = block.timestamp;

    // 1 => xxxhash [1]-> database -> 0
    // 2 => xxxtrxhas [1,2] database ->

    await OfferModel.updateOne(
      { transactionHash },
      {
        address,
        transactionHash,
        eventName,
        signature,
        offerId,
        sellerAddress,
        storeName,
        price,
        requestId,
        images,
        sellerId,
        sellerIds,
        isAccepted: false,
      },
      {
        upsert: true,
      }
    );

    await RequestModel.updateOne(
      { requestId },
      {
        sellerIds,
      },
      {
        upsert: true,
      }
    );

    const currentRequest = await RequestModel.findOne({ requestId });
    if (currentRequest && currentRequest.lifecycle === 0) {
      await RequestModel.updateOne(
        { requestId },
        {
          lifecycle: 1,
        },
        {
          upsert: true,
        }
      );
    }
  });
};
const processRequestAccepted = async ({
  latestBlockNumber,
  lastScannedBlock,
}) => {
  const events = await matchContract.getPastEvents("RequestAccepted", {
    fromBlock: lastScannedBlock + 1,
    toBlock: latestBlockNumber,
  });
  events.forEach(async (event) => {
    const { requestId, sellerId, updatedAt } = event.returnValues;
    await RequestModel.updateOne(
      { requestId },
      {
        lifecycle: 2,
        lockedSellerId: sellerId,
        updatedAt,
      },
      {
        upsert: true,
      }
    );
  });
};

const processOfferAccepted = async ({
  latestBlockNumber,
  lastScannedBlock,
}) => {
  const events = await matchContract.getPastEvents("OfferAccepted", {
    fromBlock: lastScannedBlock + 1,
    toBlock: latestBlockNumber,
  });
  events.forEach(async (event) => {
    const { offerId, isAccepted } = event.returnValues;
    await OfferModel.updateOne(
      { offerId },
      {
        isAccepted,
      },
      {
        upsert: true,
      }
    );
  });
};

const processUserCreated = async ({ latestBlockNumber, lastScannedBlock }) => {
  const events = await matchContract.getPastEvents("UserCreated", {
    fromBlock: lastScannedBlock + 1,
    toBlock: latestBlockNumber,
  });
  events.forEach(async (event) => {
    const address = event.address;
    const transactionHash = event.transactionHash;
    const eventName = event.event;
    const signature = event.signature;
    const { userAddress, userId, username, accountType } = event.returnValues;
    await UserCreatedModel.updateOne(
      { transactionHash },
      {
        userAddress,
        userId,
        username,
        accountType,
        address,
        transactionHash,
        eventName,
        signature,
      },
      {
        upsert: true,
      }
    );
  });
};

module.exports = getMarketPlaceEvents;

setInterval(async () => {
  await getMarketPlaceEvents();
  console.log("interval called");
}, 5000);
