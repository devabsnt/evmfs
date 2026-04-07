// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IEVMFS {
    function manifests(bytes32 hash) external view returns (address);
}

contract EVMFSNames is ERC721, Ownable {

    struct Site {
        uint64  blockNumber;
        bytes32 manifestHash;
    }

    IEVMFS  public immutable EVMFS_CONTRACT;
    address public feeRecipient;
    uint256 public constant  REGISTRATION_FEE = 0.001 ether;

    mapping(uint256 => Site)   public sites;
    mapping(uint256 => string) public names;

    event SiteUpdated(uint256 indexed tokenId, string siteName, uint64 blockNumber, bytes32 manifestHash);
    event FeeRecipientUpdated(address newRecipient);

    constructor(address _evmfs) ERC721("EVMFS Names", "EVMFS") Ownable(msg.sender) {
        EVMFS_CONTRACT = IEVMFS(_evmfs);
        feeRecipient = 0xc9be9069F1fD43b82145Fa8709050D52d803E81a;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        feeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(_feeRecipient);
    }

    function register(
        string calldata siteName,
        uint64 blockNumber,
        bytes32 manifestHash
    ) external payable {
        require(msg.value >= REGISTRATION_FEE, "insufficient fee");
        require(bytes(siteName).length > 0 && bytes(siteName).length <= 32, "invalid name length");
        require(_isValidName(siteName), "invalid characters");
        require(EVMFS_CONTRACT.manifests(manifestHash) == msg.sender, "not manifest uploader");

        uint256 tokenId = uint256(keccak256(bytes(siteName)));
        _mint(msg.sender, tokenId);
        names[tokenId] = siteName;
        sites[tokenId] = Site(blockNumber, manifestHash);

        emit SiteUpdated(tokenId, siteName, blockNumber, manifestHash);

        (bool sent,) = feeRecipient.call{value: msg.value}("");
        require(sent, "fee transfer failed");
    }

    function update(
        string calldata siteName,
        uint64 blockNumber,
        bytes32 manifestHash
    ) external {
        uint256 tokenId = uint256(keccak256(bytes(siteName)));
        require(ownerOf(tokenId) == msg.sender, "not owner");
        require(EVMFS_CONTRACT.manifests(manifestHash) == msg.sender, "not manifest uploader");

        sites[tokenId] = Site(blockNumber, manifestHash);
        emit SiteUpdated(tokenId, siteName, blockNumber, manifestHash);
    }

    function lookup(string calldata siteName) external view returns (
        address owner,
        uint64 blockNumber,
        bytes32 manifestHash
    ) {
        uint256 tokenId = uint256(keccak256(bytes(siteName)));
        address o = _ownerOf(tokenId);
        Site memory s = sites[tokenId];
        return (o, s.blockNumber, s.manifestHash);
    }

    function _isValidName(string calldata siteName) internal pure returns (bool) {
        bytes memory b = bytes(siteName);
        for (uint256 i; i < b.length; i++) {
            bytes1 c = b[i];
            if (c >= 0x61 && c <= 0x7A) continue; // a-z
            if (c >= 0x30 && c <= 0x39) continue; // 0-9
            if (c == 0x2D && i > 0 && i < b.length - 1) continue; // hyphen
            return false;
        }
        return true;
    }
}
