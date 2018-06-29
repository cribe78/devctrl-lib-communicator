import {
    Control,
    ControlUpdateData
} from "@devctrl/common";
import {ITCPCommandConfig, TCPCommand} from "./TCPCommand";
import {EndpointCommunicator} from "./EndpointCommunicator";


//TODO: this should be an interface, not a class, but it needs to extend the (not defined) TCPCommand interface
export class JSONRPCCommand extends TCPCommand {
    constructor(config: ITCPCommandConfig) {
        super(config);
    }

    public extractUpdateResponseValue(controlUpdate : ControlUpdateData, resp : any) : any {
        throw new Error("extractUpdateResponseValue not implemented");
    }

    extractQueryResponseValue(resp : any) : any {
        throw new Error( "extractQueryResponseValue not implemented");
    }

    updateObject(control: Control, request: ControlUpdateData) : any {
        throw new Error( "updateObject not implemented");
    }


    queryObject() : any {
        throw new Error( "queryObject not implemented");
    }
}