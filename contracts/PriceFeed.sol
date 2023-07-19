// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IPriceFeed.sol";
import "./interfaces/IProxy.sol";
import "./interfaces/IPyth.sol";
import "./interfaces/ICrossChainRateReceiver.sol";
import "./dependencies/CheckContract.sol";
import "./dependencies/BaseMath.sol";
import "./dependencies/LiquityMath.sol";

/*
* PriceFeed for zkEVM deployment, to be connected to:
* - API3 ETH/USD https://market.api3.org/dapis/polygon-zkevm/ETH-USD (Contract zkevm 0x26690F9f17FdC26D419371315bc17950a0FC90eD)
* - Pyth ETH/USD https://pyth.network/price-feeds/crypto-eth-usd (Contract zkevm 0xC5E56d6b40F3e3B5fbfa266bCd35C37426537c65, testnet 0xd54bf1758b1C932F86B178F8b1D5d1A7e2F62C2E, Price Feed ID 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace, testnet ID 0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6)
* - LayerZero wstETH/ETH CrossChainRateReceiver (zkEVM contract 0x00346D2Fd4B2Dc3468fA38B857409BC99f832ef8)
*
* The PriceFeed uses API3 as primary oracle, and Pyth as fallback. It contains logic for
* switching oracles based on oracle failures, timeouts, and conditions for returning to the primary
* API3 oracle.
*/
contract PriceFeed is Ownable, CheckContract, BaseMath, IPriceFeed {
    string constant public NAME = "PriceFeed";

    // Use to convert a price answer to an 18-digit precision uint
    uint constant public TARGET_DIGITS = 18;

    // Maximum time period allowed since oracle's latest round data timestamp, beyond which oracle is considered frozen.
    uint constant public TIMEOUT = 14400;  // 4 hours: 60 * 60 * 4

    /*
    * The maximum relative price difference between two oracle responses allowed in order for the PriceFeed
    * to return to using the API3 oracle. 18-digit precision.
    */
    uint constant public MAX_PRICE_DIFFERENCE_BETWEEN_ORACLES = 5e16; // 5%


    IProxy public api3Proxy;
    IPyth public pyth;
    ICrossChainRateReceiver public rateReceiver;
    bytes32 public pythFeedId;

    address public borrowerOperationsAddress;
    address public troveManagerAddress;

    // The last good price seen from an oracle by Liquity
    uint public lastGoodPrice;

    enum Status {
        api3Working,
        usingPythAPI3Untrusted,
        usingPythAPI3Frozen,
        bothOraclesUntrusted,
        usingAPI3PythUntrusted
    }

    // The current status of the PriceFeed, which determines the conditions for the next price fetch attempt
    Status public status;

    event PriceFeedStatusChanged(Status newStatus);

    // --- Dependency setters ---
    
    function setAddresses(
        address api3Proxy_,
        address pyth_,
        address rateReceiver_,
        bytes32 pythFeedId_
    )
        external
        onlyOwner
    {
        _checkContract(api3Proxy_);
        _checkContract(pyth_);
        _checkContract(rateReceiver_);

        api3Proxy = IProxy(api3Proxy_);
        pyth = IPyth(pyth_);
        rateReceiver = ICrossChainRateReceiver(rateReceiver_);
        pythFeedId = pythFeedId_;

        // Explicitly set initial system status
        status = Status.api3Working;

        // Get an initial price from API3 to serve as first reference for lastGoodPrice
        (int224 value, uint32 timestamp) = _getAPI3Response();

        require(!_api3IsBroken(value, timestamp) && !_api3IsFrozen(timestamp),
            "PriceFeed: API3 must be working and current");

        _storeAPI3Price(value);

        renounceOwnership();
    }

    // --- Functions ---

    /*
    * fetchPrice():
    * Returns the latest price obtained from the Oracle. Called by SIM functions that require a current price.
    *
    * Also callable by anyone externally.
    *
    * Non-view function - it stores the last good price seen by SIM.
    *
    * Uses a main oracle (API3) and a fallback oracle (Pyth) in case API3 fails. If both fail,
    * it uses the last good price seen by SIM.
    *
    */
    function fetchPrice() external override returns (uint) {
        (int224 api3Value, uint32 api3Timestamp) = _getAPI3Response();
        PythStructs.Price memory pythPrice = _getPythResponse();

        // --- CASE 1: System fetched last price from API3  ---
        if (status == Status.api3Working) {
            // If API3 is broken, try Pyth
            if (_api3IsBroken(api3Value, api3Timestamp)) {
                // If Pyth is broken then both oracles are untrusted, so return the last good price
                if (_pythIsBroken(pythPrice)) {
                    _changeStatus(Status.bothOraclesUntrusted);
                    return lastGoodPrice; 
                }
                /*
                * If Pyth is only frozen but otherwise returning valid data, return the last good price.
                */
                if (_pythIsFrozen(pythPrice)) {
                    _changeStatus(Status.usingPythAPI3Untrusted);
                    return lastGoodPrice;
                }
                
                // If API3 is broken and Pyth is working, switch to Pyth and return current Pyth price
                _changeStatus(Status.usingPythAPI3Untrusted);
                return _storePythPrice(pythPrice);
            }

            // If API3 is frozen, try Pyth
            if (_api3IsFrozen(api3Timestamp)) {
                // If Pyth is broken too, remember Pyth broke, and return last good price
                if (_pythIsBroken(pythPrice)) {
                    _changeStatus(Status.usingAPI3PythUntrusted);
                    return lastGoodPrice;     
                }

                // If Pyth is frozen or working, remember API3 froze, and switch to Pyth
                _changeStatus(Status.usingPythAPI3Untrusted);
               
                if (_pythIsFrozen(pythPrice)) {
                    return lastGoodPrice;
                }

                // If Pyth is working, use it
                return _storePythPrice(pythPrice);
            }

            // If API3 is working and Pyth is broken, remember Pyth is broken
            if (_pythIsBroken(pythPrice)) {
                _changeStatus(Status.usingAPI3PythUntrusted);
            }   

            // If API3 is working, return API3 current price (no status change)
            return _storeAPI3Price(api3Value);
        }

        // --- CASE 2: The system fetched last price from Pyth ---
        if (status == Status.usingPythAPI3Untrusted) {
            // If both Pyth and API3 are live, unbroken, and reporting similar prices, switch back to API3
            if (_bothOraclesLiveAndUnbrokenAndSimilarPrice(api3Value, api3Timestamp, pythPrice)) {
                _changeStatus(Status.api3Working);
                return _storeAPI3Price(api3Value);
            }

            if (_pythIsBroken(pythPrice)) {
                _changeStatus(Status.bothOraclesUntrusted);
                return lastGoodPrice; 
            }

            /*
            * If Pyth is only frozen but otherwise returning valid data, just return the last good price.
            * Pyth may need to be tipped to return current data.
            */
            if (_pythIsFrozen(pythPrice)) {
                return lastGoodPrice;
            }
            
            // Otherwise, use Pyth price
            return _storePythPrice(pythPrice);
        }

        // --- CASE 3: Both oracles were untrusted at the last price fetch ---
        if (status == Status.bothOraclesUntrusted) {
            /*
            * If both oracles are now live, unbroken and similar price, we assume that they are reporting
            * accurately, and so we switch back to API3.
            */
            if (_bothOraclesLiveAndUnbrokenAndSimilarPrice(api3Value, api3Timestamp, pythPrice)) {
                _changeStatus(Status.api3Working);
                return _storeAPI3Price(api3Value);
            } 

            // Otherwise, return the last good price - both oracles are still untrusted (no status change)
            return lastGoodPrice;
        }

        // --- CASE 4: Using Pyth, and API3 is frozen ---
        if (status == Status.usingPythAPI3Frozen) {
            if (_api3IsBroken(api3Value, api3Timestamp)) {
                // If both Oracles are broken, return last good price
                if (_pythIsBroken(pythPrice)) {
                    _changeStatus(Status.bothOraclesUntrusted);
                    return lastGoodPrice;
                }

                // If API3 is broken, remember it and switch to using Pyth
                _changeStatus(Status.usingPythAPI3Untrusted);

                if (_pythIsFrozen(pythPrice)) {
                    return lastGoodPrice;
                }

                // If Pyth is working, return Pyth current price
                return _storePythPrice(pythPrice);
            }

            if (_api3IsFrozen(api3Timestamp)) {
                // if API3 is frozen and Pyth is broken, remember Pyth broke, and return last good price
                if (_pythIsBroken(pythPrice)) {
                    _changeStatus(Status.usingAPI3PythUntrusted);
                    return lastGoodPrice;
                }

                // If both are frozen, just use lastGoodPrice
                if (_pythIsBroken(pythPrice)) {
                    return lastGoodPrice;
                }

                // if API3 is frozen and Pyth is working, keep using Pyth (no status change)
                return _storePythPrice(pythPrice);
            }

            // if API3 is live and Pyth is broken, remember Pyth broke, and return API3 price
            if (_pythIsBroken(pythPrice)) {
                _changeStatus(Status.usingAPI3PythUntrusted);
                return _storeAPI3Price(api3Value);
            }

             // If API3 is live and Pyth is frozen, just use last good price (no status change) since we have no basis for comparison
            if (_pythIsFrozen(pythPrice)) {
                return lastGoodPrice;
            }

            // If API3 is live and Pyth is working, compare prices. Switch to API3
            // if prices are within 5%, and return API3 price.
            if (_bothOraclesSimilarPrice(api3Value, pythPrice)) {
                _changeStatus(Status.api3Working);
                return _storeAPI3Price(api3Value);
            }

            // Otherwise if API3 is live but price not within 5% of Pyth, distrust API3, and return Pyth price
            _changeStatus(Status.usingPythAPI3Untrusted);
            return _storePythPrice(pythPrice);
        }

        // --- CASE 5: Using API3, Pyth is untrusted ---
         if (status == Status.usingAPI3PythUntrusted) {
            // If API3 breaks, now both oracles are untrusted
            if (_api3IsBroken(api3Value, api3Timestamp)) {
                _changeStatus(Status.bothOraclesUntrusted);
                return lastGoodPrice;
            }

            // If API3 is frozen, return last good price (no status change)
            if (_api3IsFrozen(api3Timestamp)) {
                return lastGoodPrice;
            }

            // If API3 and Pyth are both live, unbroken and similar price, switch back to API3 working and return API3 price
            if (_bothOraclesLiveAndUnbrokenAndSimilarPrice(api3Value, api3Timestamp, pythPrice)) {
                _changeStatus(Status.api3Working);
                return _storeAPI3Price(api3Value);
            }

            // Otherwise if API3 is live and deviated <50% from it's previous price and Pyth is still untrusted,
            // return API3 price (no status change)
            return _storeAPI3Price(api3Value);
        }

        return 0;
    }

    // --- Helper functions ---

    function _api3IsBroken(int224 value, uint32 timestamp) internal view returns (bool) {
        return value <= 0 || timestamp == 0 || timestamp > block.timestamp;
    }

    function _api3IsFrozen(uint32 timestamp) internal view returns (bool) {
        return block.timestamp - timestamp > TIMEOUT;
    }

    function _pythIsBroken(PythStructs.Price memory price) internal view returns (bool) {
        return price.price <= 0 || price.publishTime == 0 || price.publishTime > block.timestamp;
    }

    function _pythIsFrozen(PythStructs.Price memory price) internal view returns (bool) {
        return block.timestamp - price.publishTime > TIMEOUT;
    }

    function _bothOraclesLiveAndUnbrokenAndSimilarPrice(int224 api3Value, uint32 api3Timestamp, PythStructs.Price memory pythPrice) internal view returns (bool) {
        // Return false if either oracle is broken or frozen
        if (
            _pythIsBroken(pythPrice) ||
            _pythIsFrozen(pythPrice) ||
            _api3IsBroken(api3Value, api3Timestamp) ||
            _api3IsFrozen(api3Timestamp)
        ) {
            return false;
        }

        return _bothOraclesSimilarPrice(api3Value, pythPrice);
    }

    function _bothOraclesSimilarPrice(int224 api3Value, PythStructs.Price memory pythPrice) internal pure returns (bool) {
        uint scaledAPI3Price = _scaleAPI3PriceByDigits(api3Value);
        uint scaledPythPrice = _scalePythPriceByDigits(pythPrice);

        // Get the relative price difference between the oracles. Use the lower price as the denominator, i.e. the reference for the calculation.
        uint minPrice = LiquityMath._min(scaledPythPrice, scaledAPI3Price);
        uint maxPrice = LiquityMath._max(scaledPythPrice, scaledAPI3Price);
        uint percentPriceDifference = (maxPrice - minPrice) * DECIMAL_PRECISION / minPrice;

        /*
        * Return true if the relative price difference is <= 3%: if so, we assume both oracles are probably reporting
        * the honest market price, as it is unlikely that both have been broken/hacked and are still in-sync.
        */
        return percentPriceDifference <= MAX_PRICE_DIFFERENCE_BETWEEN_ORACLES;
    }

    function _scaleAPI3PriceByDigits(int224 price_) internal pure returns (uint) {
        return uint(uint224(price_));
    }

    function _scalePythPriceByDigits(PythStructs.Price memory price_) internal pure returns (uint) {
        return uint(uint64(price_.price)) * 10**(TARGET_DIGITS - uint(uint32(-price_.expo)));
    }

    function _changeStatus(Status _status) internal {
        status = _status;
        emit PriceFeedStatusChanged(_status);
    }

    function _storePrice(uint _currentPrice) internal {
        uint WSTETHPrice = _currentPrice * rateReceiver.rate() / 1e18;
        lastGoodPrice = WSTETHPrice;

        emit LastGoodPriceUpdated(WSTETHPrice);
    }

     function _storeAPI3Price(int224 price_) internal returns (uint) {
        uint scaledPrice = _scaleAPI3PriceByDigits(price_);
        _storePrice(scaledPrice);

        return scaledPrice;
    }

    function _storePythPrice(PythStructs.Price memory price_) internal returns (uint) {
        uint scaledPrice = _scalePythPriceByDigits(price_);
        _storePrice(scaledPrice);

        return scaledPrice;
    }

    // --- Oracle response wrapper functions ---

    function _getAPI3Response() internal view returns (int224 value, uint32 timestamp) {
        try api3Proxy.read() returns (int224 value_, uint32 timestamp_)
        {
            return (value_, timestamp_);
        } catch {
            return (0, 0);
        }
    }

    function _getPythResponse() internal view returns (PythStructs.Price memory price) {
        // First, try to get current decimal precision:
        try pyth.getPriceUnsafe(pythFeedId) returns (
            PythStructs.Price memory price_
        ) {
            return price_;
        } catch {
            return price;
        }
    }

}

