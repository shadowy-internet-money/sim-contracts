// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "./interfaces/IProxyControlled.sol";
import "./dependencies/ControllableV3.sol";

contract Controller is ControllableV3, IController {
  using EnumerableSet for EnumerableSet.AddressSet;
  using EnumerableMap for EnumerableMap.UintToUintMap;
  using EnumerableMap for EnumerableMap.UintToAddressMap;
  using EnumerableMap for EnumerableMap.AddressToUintMap;

  enum AddressType {
    UNKNOWN, // 0
    GOVERNANCE // 1
  }

  struct AddressAnnounce {
    uint _type;
    address newAddress;
    uint timeLockAt;
  }

  struct ProxyAnnounce {
    address proxy;
    address implementation;
    uint timeLockAt;
  }

  // *************************************************************
  //                        CONSTANTS
  // *************************************************************

  /// @dev Version of this contract. Adjust manually on each code modification.
  string public constant CONTROLLER_VERSION = "1.0.0";
  uint public constant TIME_LOCK = 18 hours;

  // *************************************************************
  //                        VARIABLES
  //                Keep names and ordering!
  //                 Add only in the bottom.
  // *************************************************************

  address public override governance;

  // --- time locks

  EnumerableMap.UintToUintMap internal _addressTimeLocks;
  EnumerableMap.UintToAddressMap internal _addressAnnounces;

  EnumerableMap.AddressToUintMap internal _proxyTimeLocks;
  mapping(address => address) public proxyAnnounces;

  // *************************************************************
  //                        EVENTS
  // *************************************************************

  event AddressChangeAnnounced(uint _type, address value);
  event AddressChanged(uint _type, address oldAddress, address newAddress);
  event AddressAnnounceRemove(uint _type);
  event ProxyUpgradeAnnounced(address proxy, address implementation);
  event ProxyUpgraded(address proxy, address implementation);
  event ProxyAnnounceRemoved(address proxy);

  // *************************************************************
  //                        INIT
  // *************************************************************

  /// @dev Proxy initialization. Call it after contract deploy.
  function init(address _governance) external initializer {
    require(_governance != address(0), "WRONG_INPUT");
    governance = _governance;
    __Controllable_init(address(this));
  }

  // *************************************************************
  //                     RESTRICTIONS
  // *************************************************************

  function _onlyGovernance() internal view {
    require(msg.sender == governance, "DENIED");
  }

  // *************************************************************
  //                        VIEWS
  // *************************************************************

  /// @dev Return all announced address changes.
  function addressAnnouncesList() external view returns (AddressAnnounce[] memory announces) {
    uint length = _addressTimeLocks.length();
    announces = new AddressAnnounce[](length);
    for (uint i; i < length; ++i) {
      (uint _type, uint timeLock) = _addressTimeLocks.at(i);
      address newAddress = _addressAnnounces.get(_type);
      announces[i] = AddressAnnounce(_type, newAddress, timeLock);
    }
  }

  /// @dev Return all announced proxy upgrades.
  function proxyAnnouncesList() external view returns (ProxyAnnounce[] memory announces) {
    uint length = _proxyTimeLocks.length();
    announces = new ProxyAnnounce[](length);
    for (uint i; i < length; ++i) {
      (address proxy, uint timeLock) = _proxyTimeLocks.at(i);
      address implementation = proxyAnnounces[proxy];
      announces[i] = ProxyAnnounce(proxy, implementation, timeLock);
    }
  }

  /// @dev See {IERC165-supportsInterface}.
  function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
    return interfaceId == InterfaceIds.I_CONTROLLER || super.supportsInterface(interfaceId);
  }

  // *************************************************************
  //          SET ADDRESSES WITH TIME-LOCK PROTECTION
  // *************************************************************

  /// @dev Add announce information for given address type.
  function announceAddressChange(AddressType _type, address value) external {
    _onlyGovernance();
    require(value != address(0), "ZERO_VALUE");
    require(_addressAnnounces.set(uint(_type), value), "ANNOUNCED");
    _addressTimeLocks.set(uint(_type), block.timestamp + TIME_LOCK);

    emit AddressChangeAnnounced(uint(_type), value);
  }

  /// @dev Change time-locked address and remove lock info.
  ///      Less strict for reduce governance actions.
  function changeAddress(AddressType _type) external {
    _onlyGovernance();

    address newAddress = _addressAnnounces.get(uint(_type));
    uint timeLock = _addressTimeLocks.get(uint(_type));
    // no need to check values - get for non-exist values will be reverted
    address oldAddress;

    if (_type == AddressType.GOVERNANCE) {
      oldAddress = governance;
      governance = newAddress;
    } else {
      revert("UNKNOWN");
    }

    // skip time-lock for initialization
    if (oldAddress != address(0)) {
      require(timeLock < block.timestamp, "LOCKED");
    }

    _addressAnnounces.remove(uint(_type));
    _addressTimeLocks.remove(uint(_type));

    emit AddressChanged(uint(_type), oldAddress, newAddress);
  }

  /// @dev Remove announced address change.
  function removeAddressAnnounce(AddressType _type) external {
    _onlyGovernance();

    _addressAnnounces.remove(uint(_type));
    _addressTimeLocks.remove(uint(_type));

    emit AddressAnnounceRemove(uint(_type));
  }

  // *************************************************************
  //          UPGRADE PROXIES WITH TIME-LOCK PROTECTION
  // *************************************************************

  function announceProxyUpgrade(
    address[] memory proxies,
    address[] memory implementations
  ) external {
    _onlyGovernance();
    require(proxies.length == implementations.length, "WRONG_INPUT");

    for (uint i; i < proxies.length; i++) {
      address proxy = proxies[i];
      address implementation = implementations[i];

      require(implementation != address(0), "ZERO_IMPL");
      require(_proxyTimeLocks.set(proxy, block.timestamp + TIME_LOCK), "ANNOUNCED");
      proxyAnnounces[proxy] = implementation;

      emit ProxyUpgradeAnnounced(proxy, implementation);
    }
  }

  /// @dev Upgrade proxy. Less strict for reduce governance actions.
  function upgradeProxy(address[] memory proxies) external {
    _onlyGovernance();

    for (uint i; i < proxies.length; i++) {
      address proxy = proxies[i];
      uint timeLock = _proxyTimeLocks.get(proxy);
      // Map get will revert on not exist key, no need to check to zero
      address implementation = proxyAnnounces[proxy];

      require(timeLock < block.timestamp, "LOCKED");

      IProxyControlled(proxy).upgrade(implementation);

      _proxyTimeLocks.remove(proxy);
      delete proxyAnnounces[proxy];

      emit ProxyUpgraded(proxy, implementation);
    }
  }

  function removeProxyAnnounce(address proxy) external {
    _onlyGovernance();

    _proxyTimeLocks.remove(proxy);
    delete proxyAnnounces[proxy];

    emit ProxyAnnounceRemoved(proxy);
  }
}
