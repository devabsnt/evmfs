// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract EVMFS {

    event Store(bytes32 indexed contentHash, bytes data);

    mapping(bytes32 => address) public manifests;

    function store(bytes calldata data) external returns (bytes32) {
        bytes32 h = keccak256(data);
        emit Store(h, data);
        return h;
    }

    function storeBatch(bytes[] calldata data) external returns (bytes32[] memory) {
        bytes32[] memory hashes = new bytes32[](data.length);
        for (uint256 i; i < data.length; i++) {
            hashes[i] = keccak256(data[i]);
            emit Store(hashes[i], data[i]);
        }
        return hashes;
    }

    function storeManifest(bytes calldata data) external returns (bytes32) {
        bytes32 h = keccak256(data);
        emit Store(h, data);
        manifests[h] = msg.sender;
        return h;
    }
}
