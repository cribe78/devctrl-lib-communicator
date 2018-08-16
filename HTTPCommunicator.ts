import {
    Control,
    ControlUpdateData,
    IEndpointStatus,
    IndexedDataSet
} from "@devctrl/common";
import {EndpointCommunicator, IEndpointCommunicatorConfig} from "./EndpointCommunicator";
import {HTTPCommand} from "./HTTPCommand";
import * as http from "http";
import {IDCCommand} from "./IDCCommand";

export class HTTPCommunicator extends EndpointCommunicator {
    commands: IndexedDataSet<IDCCommand> = {};
    commandsByTemplate: IndexedDataSet<IDCCommand> = {};
    pollTimer;
    endpointPassword = "";
    endpointUser = "";

    constructor(config: IEndpointCommunicatorConfig) {
        super(config);
    }

    buildCommandList() : void {}


    closeConnection() {
        // Not really much to do here, no persistent connection is maintained
        this.updateStatus({
            polling: false,
            responsive: false
        });

    };

    executeCommandQuery(cmd: IDCCommand) {
        if (cmd.writeonly) {
            this.log(`not querying writeonly command ${cmd.name}`, EndpointCommunicator.LOG_POLLING);
        }

        let requestPath = "http://" + this.config.endpoint.address + cmd.queryString();
        this.log("sending request:" + requestPath, EndpointCommunicator.LOG_RAW_DATA);

        let req = http.request({
            hostname: this.config.endpoint.address,
            port: this.config.endpoint.port,
            path: cmd.queryString(),
            method: "GET",
            headers: {

            },
            auth: `${this.endpointUser}:${this.endpointPassword}`
        }, (res) => {
            if (res.statusCode !== 200) {
                this.log("invalid status code response: " + res.statusCode);
            }
            else {
                this.log(`cmd ${cmd.name} successfully queried`);
                res.setEncoding('utf8');
                let body ='';
                res.on('data', (chunk) => { body += chunk});
                res.on('end', () => {
                    for (let ctid of cmd.ctidList) {
                        let control = this.controlsByCtid[ctid];
                        let val = cmd.parseQueryResponse(control, body);
                        if (typeof val !== 'undefined') {
                            this.log(`${cmd.name} response parsed: ${body},${val}`, EndpointCommunicator.LOG_POLLING);
                            this.setControlValue(control, val);
                            this.connectionConfirmed();
                        }
                        else {
                            this.log(`${cmd.name} update response did not match: ${body}`, EndpointCommunicator.LOG_MATCHING);
                        }
                    }
                });
            }
        })
            .on('error', (e) => {
                this.log(`Error on query: ${e.message}`);
                this.closeConnection();
            });
        req.end();
    }

    getControlTemplates() : IndexedDataSet<Control> {
        //TODO: figure out why the command list isn't built in the constructor
        this.buildCommandList();

        for (let cmd in this.commands) {
            let controls = this.commands[cmd].getControlTemplates();

            for (let control of controls) {
                this.controlsByCtid[control.ctid] = control;
                this.commandsByTemplate[control.ctid] = this.commands[cmd];
            }
        }

        return this.controlsByCtid;
    }

    /**
     * Process a ControlUpdate, likely by sending a command to
     * a device
     * @param update ControlUpdateData The request control update
     */
    handleControlUpdateRequest(update: ControlUpdateData) {
        let control = this.controls[update.control_id];
        let command = this.commandsByTemplate[control.ctid];

        if (! command) {
            this.log(`No command found for control ${control.name}`);
            return;
        }

        let requestPath = "http://" + this.config.endpoint.address + command.updateString(control, update.value);
        this.log("sending request:" + requestPath, EndpointCommunicator.LOG_RAW_DATA);

        let req = http.get({
            hostname: this.config.endpoint.address,
            port: this.config.endpoint.port,
            path: command.updateString(control, update.value),
            method: "GET",
            headers: {

            },
            auth: `${this.endpointUser}:${this.endpointPassword}`
        }, (res) => {
            if (res.statusCode !== 200) {
                this.log("invalid status code response: " + res.statusCode);
            }
            else {
                //debug(`${command.name} set to ${update.value} successfully`);
                res.setEncoding('utf8');
                let body ='';
                res.on('data', (chunk) => { body += chunk});
                res.on('end', () => {
                    if (command.matchUpdateResponse(control, update, body)) {
                        let newVal = command.parseUpdateResponse(control, update, body);
                        this.log(`${control.name} response successful, value: ${newVal}`, EndpointCommunicator.LOG_UPDATES);
                        this.config.controlUpdateCallback(control, newVal);
                        this.connectionConfirmed();
                    }
                    else {
                        this.log(`${control.name} update response did not match: ${body}`, EndpointCommunicator.LOG_MATCHING);
                    }
                });
            }
        }).on('error', (e) => {
            this.log(`Error on update request: ${e.message}`);
            this.closeConnection();
        });

        req.end();
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

    online() {
        if (! this.monitorTimer) {
            this.monitorTimer = setInterval(()=> {
                let offset = Date.now() - this.lastConfirmedCommunication;

                if (offset > 30000) {
                    this.updateStatus({ responsive: false });
                }
            }, 30000);
        }



        if (! this.pollTimer) {
            this.pollTimer = setInterval(() => {
                this.poll();
            }, 10000);
        }

        this.updateStatus({
            polling: true
        });
    };


    poll() {
        if (! this.epStatus.polling) {
            return;
        }

        this.log("polling device", EndpointCommunicator.LOG_POLLING);

        for (let id in this.controls) {
            let control = this.controls[id];

            if (control.poll) {
                let cmd = this.commandsByTemplate[control.ctid];

                if (cmd) {
                    this.executeCommandQuery(cmd);
                }
                else {
                    this.log("command not found for poll control " + control.ctid);
                }
            }
        }
    }


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

        // connected and loggedIn don't apply, they should always mirror polling
        es.connected = es.loggedIn = es.polling;
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
                                else {  // ok
                                    // We should never end up here. Fall through and throw error
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
                    return;
                }
            }
        }
        else { // enabled
            if (! es.reachable) {
                // Enabled, not reachable, nothing to do
                return;
            }
            else { // reachable
                if (! es.polling) {
                    this.online();
                }
                else { // polling
                    if (! es.responsive) {
                        if (statusDiff.responsive === false) {
                            // Disconnect and attempt to reconnect
                            this.closeConnection();
                        }
                    }
                    else { // responsive
                        return;
                    }
                }
            }
        }

        // We'll only fall through to here in weird unhandled cases.
        //throw new Error("unhandled status update state");
    }

}
