// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/// @title Library for interface IDs
/// @author bogdoslav
library InterfaceIds {

    /// @notice Version of the contract
    /// @dev Should be incremented when contract changed
    string public constant INTERFACE_IDS_LIB_VERSION = "1.0.0";

    /// default notation:
    /// bytes4 public constant I_VOTER = type(IVoter).interfaceId;

    /// As type({Interface}).interfaceId can be changed,
    /// when some functions changed at the interface,
    /// so used hardcoded interface identifiers

    bytes4 public constant I_VE = bytes4(keccak256("IVe"));
    bytes4 public constant I_CONTROLLER = bytes4(keccak256("IController"));
    bytes4 public constant I_TETU_ERC165 = bytes4(keccak256("ITetuERC165"));
    bytes4 public constant I_CONTROLLABLE = bytes4(keccak256("IControllable"));
    bytes4 public constant I_VE_DISTRIBUTOR = bytes4(keccak256("IVeDistributor"));
}
