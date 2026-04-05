// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/EVMFS.sol";

contract DeployEVMFS is Script {
    address constant SAFE_SINGLETON_FACTORY = 0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7;

    bytes32 constant SALT = bytes32(uint256(0x45564d465300000000000000000000000000000000000000000000000000000));

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        bytes memory creationCode = type(EVMFS).creationCode;
        bytes memory payload = abi.encodePacked(SALT, creationCode);

        address expected = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff),
                            SAFE_SINGLETON_FACTORY,
                            SALT,
                            keccak256(creationCode)
                        )
                    )
                )
            )
        );

        console.log("Expected EVMFS address:", expected);

        if (expected.code.length > 0) {
            console.log("EVMFS already deployed at expected address");
            return;
        }

        vm.startBroadcast(deployerKey);

        (bool success, ) = SAFE_SINGLETON_FACTORY.call(payload);
        require(success, "CREATE2 deployment failed");

        vm.stopBroadcast();

        require(expected.code.length > 0, "Deployment verification failed");
        console.log("EVMFS deployed at:", expected);
    }
}
