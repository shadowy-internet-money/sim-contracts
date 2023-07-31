// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "../interfaces/IVe.sol";

contract PawnshopMock is IERC721Receiver {

  function transfer(address nft, address from, address to, uint id) external {
    IERC721(nft).safeTransferFrom(from, to, id);
  }

  function transferAndGetBalance(address nft, address from, address to, uint id) external returns (uint){
    IERC721(nft).safeTransferFrom(from, to, id);
    return IVe(nft).balanceOfNFT(id);
  }

  function doubleTransfer(address nft, address from, address to, uint id) external {
    IERC721(nft).safeTransferFrom(from, to, id);
    IERC721(nft).safeTransferFrom(to, from, id);
    IERC721(nft).safeTransferFrom(from, to, id);
  }

  function veFlashTransfer(address ve, uint tokenId) external {
    IERC721(ve).safeTransferFrom(msg.sender, address(this), tokenId);
    require(IVe(ve).balanceOfNFT(tokenId) == 0, "not zero balance");
    IVe(ve).totalSupplyAt(block.number);
    IVe(ve).checkpoint();
    IVe(ve).checkpoint();
    IVe(ve).checkpoint();
    IVe(ve).checkpoint();
    IVe(ve).totalSupplyAt(block.number);
    IVe(ve).totalSupplyAt(block.number - 1);
    IERC721(ve).safeTransferFrom(address(this), msg.sender, tokenId);
  }

  function onERC721Received(
    address,
    address,
    uint256,
    bytes memory
  ) public virtual override returns (bytes4) {
    return this.onERC721Received.selector;
  }

}
