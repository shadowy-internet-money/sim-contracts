import {ecsign} from "ethereumjs-util";
import {defaultAbiCoder, keccak256, solidityPack, toUtf8Bytes} from "ethers/lib/utils";

export class PermitHelper {
    static sign = (digest:string, privateKey:string) => {
        return ecsign(Buffer.from(digest.slice(2), 'hex'), Buffer.from(privateKey.slice(2), 'hex'))
    }

    static PERMIT_TYPEHASH = keccak256(
        toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
    )

    static getDomainSeparator = (name:string, contractAddress:string, chainId:string, version:string) => {
        return keccak256(defaultAbiCoder.encode(['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
            [
                keccak256(toUtf8Bytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
                keccak256(toUtf8Bytes(name)),
                keccak256(toUtf8Bytes(version)),
                parseInt(chainId), contractAddress.toLowerCase()
            ]))
    }

    static getPermitDigest = (
        name: string,
        address: string,
        chainId:string,
        version:string,
        owner:string,
        spender:string,
        value:number,
        nonce:string,
        deadline:number
    ) => {
        const DOMAIN_SEPARATOR = this.getDomainSeparator(name, address, chainId, version)
        return keccak256(solidityPack(['bytes1', 'bytes1', 'bytes32', 'bytes32'],
            ['0x19', '0x01', DOMAIN_SEPARATOR,
                keccak256(defaultAbiCoder.encode(
                    ['bytes32', 'address', 'address', 'uint256', 'uint256', 'uint256'],
                    [this.PERMIT_TYPEHASH, owner, spender, value, nonce, deadline])),
            ]))
    }
}