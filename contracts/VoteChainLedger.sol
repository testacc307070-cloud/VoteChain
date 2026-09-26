// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract VoteChainLedger {
    mapping(bytes32 => bool) public commitmentUsed;

    event VoteRecorded(
        bytes32 indexed electionId,
        bytes32 indexed commitment,
        address indexed submitter,
        uint256 timestamp
    );

    function recordVote(bytes32 electionId, bytes32 commitment) external {
        require(!commitmentUsed[commitment], "commitment already recorded");
        commitmentUsed[commitment] = true;
        emit VoteRecorded(electionId, commitment, msg.sender, block.timestamp);
    }
}