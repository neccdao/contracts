// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;
import "../../lib/LibBondStorage.sol";

library BondDepositoryLib {
    function getIndexAt(LibBondStorage.Storage storage s, address _principle)
        internal
        view
        returns (uint256 _index)
    {
        uint256 _principleLength = EnumerableSet.length(s.principles);
        for (uint256 i = 0; i < _principleLength; i++) {
            if (EnumerableSet.at(s.principles, i) == _principle) {
                return i;
            }
        }
    }
}
