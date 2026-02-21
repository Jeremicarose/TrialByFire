// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MockFunctionsRouter
 * @notice Minimal mock of the Chainlink Functions Router for local testing.
 *
 * The real Chainlink Functions Router lives on public testnets (Sepolia)
 * and handles routing requests to DON nodes. On a local Hardhat node,
 * there's no DON, so we need a mock that:
 *
 *   1. Satisfies the FunctionsClient constructor (just needs a valid address)
 *   2. Accepts sendRequest() calls without reverting
 *   3. Allows tests to simulate DON callbacks via simulateResponse()
 *
 * How it works:
 *   - When TrialMarket calls _sendRequest(), the router's sendRequest()
 *     is called. Our mock generates a deterministic request ID and stores it.
 *   - Tests can then call simulateResponse() to trigger the callback,
 *     simulating what the DON would do on a real network.
 *
 * This is NOT a full router implementation. It only implements the
 * interface methods that TrialMarket actually calls.
 */
contract MockFunctionsRouter {
    /*
     * Track the last request so tests can simulate the response.
     * In the real router, requests go to DON nodes. Here, we just
     * store them for test retrieval.
     */
    uint256 private _requestCounter;

    struct PendingRequest {
        address consumer;    // The contract that sent the request
        bytes data;          // CBOR-encoded request data
        bool fulfilled;      // Whether simulateResponse was called
    }

    mapping(bytes32 => PendingRequest) public requests;
    bytes32 public lastRequestId;

    /**
     * @notice Called by FunctionsClient._sendRequest() via the router interface.
     *
     * The real router validates the subscription, charges LINK, and
     * distributes the request to DON nodes. Our mock just stores it
     * and returns a deterministic request ID.
     *
     * Parameters match IFunctionsRouter.sendRequest():
     *   subscriptionId — ignored in mock (no LINK charging)
     *   data — the CBOR-encoded Functions request
     *   dataVersion — ignored (always version 1)
     *   callbackGasLimit — ignored (no gas metering in mock)
     *   donId — ignored (no DON routing)
     */
    function sendRequest(
        uint64,          // subscriptionId
        bytes calldata data,
        uint16,          // dataVersion
        uint32,          // callbackGasLimit
        bytes32          // donId
    ) external returns (bytes32 requestId) {
        _requestCounter++;
        requestId = keccak256(abi.encodePacked(_requestCounter, msg.sender));

        requests[requestId] = PendingRequest({
            consumer: msg.sender,
            data: data,
            fulfilled: false
        });
        lastRequestId = requestId;
    }

    /**
     * @notice Test helper — simulate the DON responding to a request.
     * @param requestId The request to fulfill
     * @param response ABI-encoded response data
     * @param err Error bytes (empty for success)
     *
     * Calls handleOracleFulfillment() on the consumer contract,
     * which is the same callback the real DON router would invoke.
     * This triggers TrialMarket._fulfillRequest().
     */
    function simulateResponse(
        bytes32 requestId,
        bytes calldata response,
        bytes calldata err
    ) external {
        PendingRequest storage req = requests[requestId];
        require(req.consumer != address(0), "Request not found");
        require(!req.fulfilled, "Already fulfilled");
        req.fulfilled = true;

        /*
         * Call the consumer's handleOracleFulfillment function.
         * This is the standard Chainlink Functions callback interface.
         * FunctionsClient.handleOracleFulfillment() checks that
         * msg.sender == router, then calls _fulfillRequest() internally.
         */
        (bool success, bytes memory returnData) = req.consumer.call(
            abi.encodeWithSignature(
                "handleOracleFulfillment(bytes32,bytes,bytes)",
                requestId,
                response,
                err
            )
        );
        require(success, string(returnData));
    }
}
