import {EndpointCommunicator, IEndpointCommunicatorConfig} from "./EndpointCommunicator";
import { TCPCommand } from "./TCPCommand";
import * as net from "net";
import {
    Control,
    ControlUpdateData,
    Endpoint,
    IEndpointStatus,
    IndexedDataSet
} from "@devctrl/common";



export type TCPCommEncoding = "string" | "hex";

//TODO: convert expectedResponse from an array to a proper object

export class TCPCommunicator extends EndpointCommunicator {
    socket: net.Socket;
    commands: IndexedDataSet<TCPCommand> = {};
    commandsByTemplate: IndexedDataSet<TCPCommand> = {};
    inputLineTerminator : string | RegExp = '\r\n';
    outputLineTerminator = '\r\n';
    socketEncoding = 'utf8';
    inputBuffer: string = '';


    expectedResponses: [string | RegExp, (line: string) => any][] = [];
    commsMode : TCPCommEncoding = "string";

    closingConnection = false;
    openingConnection = false;
    protected lastConnectTimeout;
    protected lastConnectAttemptTime = 0;



    constructor(config: IEndpointCommunicatorConfig) {
        super(config);
    }

    buildCommandList() {

    }

    closeConnection() {
        if (this.openingConnection) {
            this.log("openingConnection in progress, skipping close connection", EndpointCommunicator.LOG_CONNECTION);
            return;
        }
        if (! this.closingConnection) {
            if (this.socket) {
                this.closingConnection = true;
                this.log("closing connection to device");
                this.socket.end();

                setTimeout(()=> {
                    // Avoid getting stuck in purgatory if socket.end() doesn't produce the right event
                    this.closingConnection = false;
                }, 5000);
            }
            else {
                this.log("closeConnection: skipping close connection");
                this.onEnd();
            }
        }
        else {
            this.log("closing connection already in process", EndpointCommunicator.LOG_CONNECTION);
        }
    }



    doDeviceLogon() {
        // Dummy method, update status and return
        this.updateStatus( {
            loggedIn: true,
        });
    };

    executeCommandQuery(cmd: TCPCommand) {
        if (! cmd.queryString()) {
            return;
        }

        let queryStr = cmd.queryString();
        this.log("sending query: " + queryStr, EndpointCommunicator.LOG_POLLING);
        this.writeToSocket(queryStr + this.outputLineTerminator);

        this.expectedResponses.push([
            cmd.queryResponseMatchString(),
            (line) => {
                for (let ctid of cmd.ctidList) {
                    let control = this.controlsByCtid[ctid];
                    //debug("control id is " + control._id);
                    let val = cmd.parseQueryResponse(control, line);
                    this.setControlValue(control, val);
                }

                this.connectionConfirmed();
            }
        ]);
    }

    public getControlTemplates() : IndexedDataSet<Control> {
        this.buildCommandList();

        for (let cmd in this.commands) {
            let templateList = this.commands[cmd].getControlTemplates();

            for (let tpl of templateList) {
                // Don't mess with this.controls.  That belongs to the data model
                //this.controls[tpl._id] = tpl;
                this.controlsByCtid[tpl.ctid] = tpl;
                this.commandsByTemplate[tpl.ctid] = this.commands[cmd];
            }
        }

        return this.controlsByCtid;
    }

    public handleControlUpdateRequest(request: ControlUpdateData) {
        let control = this.controls[request.control_id];

        if (! this.epStatus.ok) {
            // Update can't be processed, remind
            this.log("update cannot be processed, communicator not connected", EndpointCommunicator.LOG_UPDATES);
            this.config.statusUpdateCallback();
            return;
        }

        let command = this.commandsByTemplate[control.ctid];

        if (command) {
            let updateStr = command.updateString(control, request);
            this.log("queueing update: " + updateStr, EndpointCommunicator.LOG_UPDATES);

            this.queueCommand(updateStr + this.outputLineTerminator,
                [
                    command.updateResponseMatchString(request),
                    (line) => {
                        this.setControlValue(control, request.value);
                    }
                ]
            );

            // Mark this control as indeterminate, in case we see a query or other update
            // regarding it but the expected response never comes
            this.indeterminateControls[request.control_id] = true;
        }
    }




    initStatus() {
        let es = this.epStatus;
        es.reachable = false;
        es.connected = false;
        es.loggedIn = false;
        es.polling = false;
        es.responsive = false;
        es.ok = false;
        this.config.statusUpdateCallback();
        this.launchPing();
    }




    matchLineToCommand(line: string) : TCPCommand | boolean {
        for (let cmdStr in this.commands) {
            let cmd = this.commands[cmdStr];

            if (cmd.matchesReport(line)) {
                this.log("read: " + line + ", matches cmd " + cmd.name, EndpointCommunicator.LOG_MATCHING);
                return cmd;
            }
        }

        return false;
    }

    matchLineToError(line: string) : boolean {

        return false;
    }

    matchLineToExpectedResponse(line: string) : boolean {
        for (let idx = 0; idx < this.expectedResponses.length; idx++) {
            let eresp = this.expectedResponses[idx];

            if (line.search(<string>eresp[0]) > -1 ) {
                this.log(`${line} matched expected response "${eresp[0]}" at [${idx}]`, EndpointCommunicator.LOG_MATCHING);
                //Execute expected response callback
                eresp[1](line);

                this.expectedResponses = this.expectedResponses.slice(idx + 1);
                return true;
            }
        }

        return false;
    }

    onData(data: any) {
        let strData = '';
        if (this.commsMode == 'string') {
            strData = String(data);
        }
        else if (this.commsMode == 'hex') {
            strData = data.toString('hex');
        }

        this.inputBuffer += strData;
        let lines = this.inputBuffer.split(this.inputLineTerminator);

        while (lines.length > 1) {
            this.log("data received: " + lines[0], EndpointCommunicator.LOG_RAW_DATA);
            this.processLine(lines[0]);

            lines.splice(0,1);
        }

        this.inputBuffer = lines[0];
    }

    onEnd() {
        this.log("device disconnected : " + this.endpoint.address);
        console.trace();
        if (this.backoffTime < 20000) {
            this.backoffTime = this.backoffTime * 2;
        }

        if (this.socket) {
            this.log("destroying socket", EndpointCommunicator.LOG_CONNECTION);
            this.socket.destroy();
        }

        this.socket = undefined;
        this.closingConnection = false;
        this.openingConnection = false;

        this.updateStatus({
            connected: false,
            loggedIn: false,
            polling: false,
            responsive: false
        });
    }

    /**
     *  Functions to perform after login
     */
    online() {

        if (! this.monitorTimer) {
            this.monitorTimer = setInterval(()=> {
                let offset = Date.now() - this.lastConfirmedCommunication;

                if (offset > 30000) {
                    this.log(`${offset}ms since last communication received, setting status to unresponsive`,
                        EndpointCommunicator.LOG_STATUS);
                    this.updateStatus({ responsive: false });
                }
            }, 30000);
        }


        this.queryAll();

        if (! this.pollTimer) {
            this.pollTimer = setInterval(() => {
                this.poll();
            }, 10000);
        }

        // This needs to set responsive to true
        this.updateStatus({
            polling: true,
        });
    }


    openConnection() {
        if (this.closingConnection) {
            this.log("closing connection already in process, will not open", EndpointCommunicator.LOG_CONNECTION);
            return;
        }
        if (this.openingConnection) {
            this.log("openingConnection in progress, skipping open connection", EndpointCommunicator.LOG_CONNECTION);
            return;
        }

        // Rate limit connection attempt
        if (Date.now() - this.lastConnectAttemptTime < this.backoffTime) {
            if (! this.lastConnectTimeout) {
                this.lastConnectTimeout = setTimeout(() => {
                    this.openConnection()
                }, this.backoffTime);
                return;
            }
        }

        this.openingConnection = true;

        if (this.backoffTime < 20000) {
            this.backoffTime = this.backoffTime * 2;
        }

        this.lastConnectAttemptTime = Date.now();
        if (this.lastConnectTimeout) {
            clearTimeout(this.lastConnectTimeout);
            this.lastConnectTimeout = false;
        }

        let connectOpts = {
            port: this.config.endpoint.port,
            host: this.config.endpoint.ip
        };

        this.log(`opening TCP connection to ${connectOpts.host}:${connectOpts.port}`, EndpointCommunicator.LOG_CONNECTION);
        this.socket = net.connect(connectOpts, () => {
            this.log("connected to " + connectOpts.host + ":" + connectOpts.port, EndpointCommunicator.LOG_CONNECTION);
            this.openingConnection = false;
            this.updateStatus({ connected: true });
        });

        this.socket.on('error', (e) => {
            this.log("caught socket error: " + e.message, EndpointCommunicator.LOG_CONNECTION);
            this.openingConnection = false;
            this.onEnd();
        });
        this.socket.on('data', (data) => {
            this.onData(data);
        });
        this.socket.on('end', () => {
            this.openingConnection = false;
            this.onEnd();
        });
    }

    poll() {
        if (! this.epStatus.polling) {
            return;
        }

        let exd = this.expectedResponses.length;
        if (exd > 1000) {
            this.log(`WARNING polling device, expected response queue has reached length of ${exd}`);
        }


        let commandsPolled = [];

        for (let id in this.controls) {
            let control = this.controls[id];

            if (control.poll) {
                let cmd = this.commandsByTemplate[control.ctid];

                if (cmd) {
                    // Multiple controls may share a command.  Don't execute the same command multiple times
                    if (commandsPolled.indexOf(cmd.cmdStr) == -1) {
                        this.executeCommandQuery(cmd);
                        commandsPolled.push(cmd.cmdStr);
                    }
                    else {
                        this.log("command " + cmd.cmdStr + " already polled this cycle", TCPCommunicator.LOG_POLLING);
                    }
                }
                else {
                    this.log("command not found for poll control " + control.ctid);
                }
            }
        }
    }

    get port() : number {
        return this.config.endpoint.port;
    }


    preprocessLine(line: string) : string {
        return line;
    }

    processLine(line: string) {
        line = this.preprocessLine(line);

        //Ignore empty lines
        if (line == '') return;

        if (this.matchLineToError(line)) {
            return;
        }

        // Check line against expected responses
        if (this.matchLineToExpectedResponse(line)) {
            return;
        }

        // Match line to a command
        let match = this.matchLineToCommand(line);


        if (match) {
            let cmd = <TCPCommand>match;
            for (let ctid of cmd.ctidList) {
                let control = this.controlsByCtid[ctid];

                let val = cmd.parseReportValue(control, line);
                this.setControlValue(control, val);
            }

            this.connectionConfirmed();

        }
        else {
            this.log("read, unmatched: " + line, EndpointCommunicator.LOG_MATCHING);
        }
    }

    /**
     * This implementation just writes the command to the socket.  Child classes
     * can do fancier things
     */

    queueCommand(cmdStr : string, expectedResponse: [string | RegExp, (line: string) => any]) {
        this.writeToSocket(cmdStr);

        if (expectedResponse[0] == '') {
            // Get on with it
            expectedResponse[1]('');
        }
        else {
            this.expectedResponses.push(expectedResponse);
        }
    }

    /**
     * Query all controls, regardless of poll setting.
     *
     * Override this method to exclude polling of certain controls
     */

    queryAll() {
        for (let cmdStr in this.commands) {
            if (! this.commands[cmdStr].writeonly) {
                this.executeCommandQuery(this.commands[cmdStr]);
            }
        }
    }


    /**
     * Reset the device connection
     */
    reset() {
        this.closeConnection();
        this.initStatus();
    }


    /**
     * The device connection lifecycle is driven by these status updates
     * @param {IEndpointStatus} status
     */

    updateStatus(statusChanges: IEndpointStatus) {
        let statusDiff= this.config.endpoint.statusDiff(statusChanges);
        let statusUnchanged = this.config.endpoint.compareStatus(statusChanges);
        let es = this.epStatus;

        if (! (es === this.config.endpoint.epStatus)) {
            this.log("epStatus mismathc!!!", EndpointCommunicator.LOG_STATUS);
        }

        let diffStr = "";
        // Set the new values
        for (let f in statusDiff) {
            es[f] = statusDiff[f];
            diffStr += f;
            diffStr += " ";
        }

        es.ok = ( es.enabled && es.reachable && es.connected && es.loggedIn && es.polling && es.responsive);

        let statusStr = this.endpoint.statusStr;
        this.log("status update: " + statusStr, EndpointCommunicator.LOG_STATUS);

        if (! statusUnchanged) {
            //this.log("status diff: " + diffStr, EndpointCommunicator.LOG_STATUS);
            this.config.statusUpdateCallback();
        }


        // Figure out what to do next
        if (! es.enabled) {
            if (! es.reachable) {
                if (! es.connected) {
                    if (! es.loggedIn) {
                        if (! es.polling) {
                            if (!es.responsive) {
                                if (!es.ok) {
                                    // Stopped.  Nothing to do.
                                    return;
                                }
                            }
                            else { // responsive
                                this.closeConnection();
                                return;
                            }
                        }
                        else { // polling
                            this.closeConnection();
                            return;
                        }
                    }
                    else { // loggedIn
                        this.closeConnection();
                        return;
                    }
                }
                else { // connected
                    this.closeConnection();
                    return;
                }
            }
            else { // reachable
                if (es.connected) {
                    this.closeConnection();
                }
            }
        }
        else { // enabled
            if (! es.reachable) {
                // Enabled, not reachable, nothing to do
                return;
            }
            else { // reachable
                if (! es.connected) {
                    this.openConnection();
                    return;
                }
                else { // connected
                    if (! es.loggedIn) {
                        this.doDeviceLogon();
                        return;
                    }
                    else { // loggedIn
                        if (! es.polling) {
                            this.online();
                            return;
                        }
                        else { // polling
                            if (! es.responsive) {
                                if (statusDiff.responsive === false) {
                                    // Disconnect and attempt to reconnect
                                    this.closeConnection();
                                }
                                return;
                            }
                            else {
                                // All good. Return
                                return;
                            }
                        }
                    }
                }
            }
        }

        // We'll only fall through to here in weird unhandled cases.
        //throw new Error("unhandled status update state");
    }


    writeToSocket(val: string) {
        let bufMode = 'ascii';
        if (this.commsMode == 'hex') {
            val = val.replace(/[\s:]/g, '');  // Allow definitions of hex strings to include byte delimeters
            bufMode = 'hex';
        }

        this.log(`sending data: ${val}`, EndpointCommunicator.LOG_RAW_DATA);
        let bufferToSend = Buffer.from(val, bufMode);
        this.socket.write(bufferToSend);
    }
}