// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract VoteChainLedger {
    enum ElectionState { NONE, CREATED, LOCKED, ACTIVE, CLOSED, FINALIZED }

    struct ElectionInfo {
        bytes32 configHash;
        ElectionState state;
        bytes32 merkleRoot;
        bytes32 resultsDigest;
        uint256 voteCount;
        uint256 createdAt;
        uint256 closedAt;
    }

    mapping(bytes32 => ElectionInfo) public elections;
    mapping(bytes32 => bool) public commitmentUsed;

    event ElectionRegistered(bytes32 indexed electionId, bytes32 configHash, address indexed creator);
    event ElectionStateChanged(bytes32 indexed electionId, ElectionState state);
    event ElectionFinalized(bytes32 indexed electionId, bytes32 merkleRoot, bytes32 resultsDigest);
    event VoteRecorded(
        bytes32 indexed electionId,
        bytes32 indexed commitment,
        address indexed submitter,
        uint256 timestamp
    );

    function registerElection(bytes32 electionId, bytes32 configHash) external {
        require(elections[electionId].state == ElectionState.NONE, "election already exists");
        elections[electionId] = ElectionInfo({
            configHash: configHash,
            state: ElectionState.CREATED,
            merkleRoot: bytes32(0),
            resultsDigest: bytes32(0),
            voteCount: 0,
            createdAt: block.timestamp,
            closedAt: 0
        });
        emit ElectionRegistered(electionId, configHash, msg.sender);
    }

    function setElectionState(bytes32 electionId, ElectionState newState) external {
        require(elections[electionId].state != ElectionState.NONE, "election not registered");
        elections[electionId].state = newState;
        if (newState == ElectionState.CLOSED) {
            elections[electionId].closedAt = block.timestamp;
        }
        emit ElectionStateChanged(electionId, newState);
    }

    function recordVote(bytes32 electionId, bytes32 commitment) external {
        require(!commitmentUsed[commitment], "commitment already recorded");
        commitmentUsed[commitment] = true;
        if (elections[electionId].state != ElectionState.NONE) {
            elections[electionId].voteCount += 1;
        }
        emit VoteRecorded(electionId, commitment, msg.sender, block.timestamp);
    }

    function finalizeElection(bytes32 electionId, bytes32 merkleRoot, bytes32 resultsDigest) external {
        require(elections[electionId].state != ElectionState.NONE, "election not registered");
        elections[electionId].state = ElectionState.FINALIZED;
        elections[electionId].merkleRoot = merkleRoot;
        elections[electionId].resultsDigest = resultsDigest;
        emit ElectionFinalized(electionId, merkleRoot, resultsDigest);
    }

    function getElection(bytes32 electionId) external view returns (
        bytes32 configHash,
        ElectionState state,
        bytes32 merkleRoot,
        bytes32 resultsDigest,
        uint256 voteCount
    ) {
        ElectionInfo memory info = elections[electionId];
        return (info.configHash, info.state, info.merkleRoot, info.resultsDigest, info.voteCount);
    }
}